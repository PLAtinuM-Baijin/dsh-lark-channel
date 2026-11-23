/**
 * 定时任务的存储与时间计算；不依赖 dsh / 飞书 SDK，方便单独理解。
 *
 * 任务形如 { id, chatId, prompt, daily: 'HH:MM' | null, nextAt, createdAt, attempts }：
 *   - daily === null：一次性任务，触发后删除；
 *   - daily !== null：每天该时刻重复，触发后 nextAt 直接滚到下一次。
 * 文件写入按进程内串行队列 + 临时文件 rename 原子替换；重启后任务仍在。
 *
 * 为什么不用 dsh 自带的 dsh-schedule：它的提醒绑定在创建当天的 Session id 上，
 * 而本 channel 每个 chat 按天轮换 Session；绑旧 id 会让提醒永远落在过期的会话里。
 * 这里只存「目标 chat」，触发时再取当天的 Session，语义才对得上。
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { dirname } from 'node:path'

export const MAX_TASKS = 50
export const MAX_PROMPT_CHARS = 2000
/** 一次性任务错过超过这么久（如服务器宕机多日）就作废，不再补发。 */
const GRACE_MS = 24 * 60 * 60 * 1000
const RETRY_DELAY_MS = 60 * 1000
const RETRY_LIMIT = 3

export function createScheduler({ file, timeZone, log }) {
  let tasks = []
  let loaded = false
  let writeChain = Promise.resolve()
  const wallFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  function wallParts(epoch) {
    const parts = {}
    for (const part of wallFormatter.formatToParts(new Date(epoch))) {
      if (part.type !== 'literal') parts[part.type] = part.value
    }
    return {
      y: Number(parts.year),
      mo: Number(parts.month),
      d: Number(parts.day),
      h: Number(parts.hour),
      mi: Number(parts.minute),
      s: Number(parts.second),
    }
  }

  /** 把「时区里的墙钟时间」换算成 epoch：先假设它是 UTC，再按观测到的时差迭代修正。 */
  function zonedEpoch(y, mo, d, h, mi) {
    const target = Date.UTC(y, mo - 1, d, h, mi, 0)
    let guess = target
    for (let i = 0; i < 2; i += 1) {
      const p = wallParts(guess)
      const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s)
      guess = target - (seen - guess)
    }
    return guess
  }

  /** HH:MM 的下一次触发时刻（严格晚于 now）。 */
  function nextDaily(hour, minute, now) {
    let p = wallParts(now)
    let candidate = zonedEpoch(p.y, p.mo, p.d, hour, minute)
    for (let i = 0; i < 4 && candidate <= now; i += 1) {
      // 用 UTC 的“日期 +1”滚到下一天，天然处理月末与闰年。
      const next = new Date(Date.UTC(p.y, p.mo - 1, p.d + 1))
      p = { y: next.getUTCFullYear(), mo: next.getUTCMonth() + 1, d: next.getUTCDate(), h: 0, mi: 0, s: 0 }
      candidate = zonedEpoch(p.y, p.mo, p.d, hour, minute)
    }
    if (candidate <= now) throw new Error('无法计算下一次每日触发时间')
    return candidate
  }

  function parseAt(text, now) {
    const wall = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
    if (wall !== null) {
      const [, y, mo, d, h, mi, s] = wall
      const epoch =
        zonedEpoch(Number(y), Number(mo), Number(d), Number(h), Number(mi)) +
        (s === undefined ? 0 : Number(s) * 1000)
      if (epoch <= now) throw new Error(`at 时间 ${text} 已经过去（按 ${timeZone}）`)
      return epoch
    }
    const epoch = Date.parse(text)
    if (!Number.isFinite(epoch)) throw new Error('at 需要 "YYYY-MM-DD HH:MM"（按配置时区）或带时区的 ISO 8601')
    if (epoch <= now) throw new Error(`at 时间 ${text} 已经过去`)
    return epoch
  }

  function parseTiming(timing, now) {
    const source = timing ?? {}
    const provided = ['afterSeconds', 'at', 'daily'].filter(
      (key) => source[key] !== undefined && source[key] !== null && source[key] !== '',
    )
    if (provided.length !== 1) throw new Error('定时参数必须且只能给一个：after_seconds / at / daily')

    if (source.afterSeconds !== undefined) {
      const seconds = Number(source.afterSeconds)
      if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('after_seconds 必须是正数')
      return { daily: null, nextAt: now + Math.round(seconds * 1000) }
    }
    if (source.at !== undefined) {
      return { daily: null, nextAt: parseAt(String(source.at).trim(), now) }
    }
    const daily = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(source.daily).trim())
    if (daily === null) throw new Error('daily 需要 24 小时制 "HH:MM"')
    const hour = Number(daily[1])
    return {
      daily: `${String(hour).padStart(2, '0')}:${daily[2]}`,
      nextAt: nextDaily(hour, Number(daily[2]), now),
    }
  }

  async function create({ chatId, prompt, timing }) {
    await load()
    const text = String(prompt ?? '').trim()
    if (text === '') throw new Error('定时任务需要 text（到点交给模型的任务内容）')
    if (Array.from(text).length > MAX_PROMPT_CHARS) throw new Error(`text 超过 ${MAX_PROMPT_CHARS} 字符`)
    if (tasks.length >= MAX_TASKS) throw new Error(`最多同时存在 ${MAX_TASKS} 个定时任务，请先取消旧的`)

    const parsed = parseTiming(timing, Date.now())
    const task = {
      id: `t${randomUUID().slice(0, 8)}`,
      chatId,
      prompt: text,
      daily: parsed.daily,
      nextAt: parsed.nextAt,
      createdAt: Date.now(),
      attempts: 0,
    }
    tasks.push(task)
    await persist()
    return { ...task }
  }

  async function list() {
    await load()
    return [...tasks].sort((a, b) => a.nextAt - b.nextAt).map((task) => ({ ...task }))
  }

  async function cancel(id) {
    await load()
    const index = tasks.findIndex((task) => task.id === id)
    if (index < 0) return undefined
    const [task] = tasks.splice(index, 1)
    await persist()
    return task
  }

  /**
   * 取出所有到点任务；一次性任务删除，每日任务滚到下一次。
   * 先落盘再返回，进程中途崩溃也不会把同一次触发重复执行。
   */
  async function due(now) {
    await load()
    const fired = []
    let changed = false
    const keep = []
    for (const task of tasks) {
      if (task.nextAt > now) {
        keep.push(task)
        continue
      }
      fired.push({ ...task })
      changed = true
      if (task.daily === null) continue
      const [hour, minute] = task.daily.split(':').map(Number)
      task.nextAt = nextDaily(hour, minute, now)
      task.attempts = 0
      keep.push(task)
    }
    tasks = keep
    if (changed) await persist()
    return fired
  }

  /** 一次性任务投递失败时排到 60 秒后重试；连续失败 3 次放弃。每日任务已滚到下一天。 */
  async function retry(task, now = Date.now()) {
    if (task.daily !== null) return false
    const attempts = (task.attempts ?? 0) + 1
    if (attempts >= RETRY_LIMIT) {
      log.warn(`feishu-scheduler: task ${task.id} failed ${attempts} times; giving up`)
      return false
    }
    tasks.push({ ...task, attempts, nextAt: now + RETRY_DELAY_MS })
    await persist()
    return true
  }

  async function load() {
    if (loaded) return
    loaded = true
    let raw
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn(`feishu-scheduler: failed to read ${file}: ${String(error)}`)
      return
    }
    try {
      const data = JSON.parse(raw)
      const now = Date.now()
      const valid = []
      for (const task of Array.isArray(data?.tasks) ? data.tasks : []) {
        if (!isTask(task)) {
          log.warn(`feishu-scheduler: dropped malformed task entry in ${file}`)
          continue
        }
        if (task.daily === null && task.nextAt < now - GRACE_MS) {
          log.warn(`feishu-scheduler: dropped stale one-off task ${task.id} (missed by more than 24h)`)
          continue
        }
        if (task.daily !== null && task.nextAt <= now) {
          const [hour, minute] = task.daily.split(':').map(Number)
          task.nextAt = nextDaily(hour, minute, now)
        }
        valid.push(task)
      }
      tasks = valid
    } catch (error) {
      log.warn(`feishu-scheduler: ${file} is not valid JSON; starting with no tasks: ${String(error)}`)
      tasks = []
    }
  }

  function isTask(task) {
    if (task === null || typeof task !== 'object') return false
    if (typeof task.id !== 'string' || task.id === '') return false
    if (typeof task.chatId !== 'string' || !/^oc_[A-Za-z0-9]+$/.test(task.chatId)) return false
    if (typeof task.prompt !== 'string' || task.prompt.trim() === '') return false
    if (!Number.isFinite(task.nextAt)) return false
    if (task.daily !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.daily)) return false
    if (!Number.isFinite(task.attempts ?? 0)) task.attempts = 0
    return true
  }

  function persist() {
    const snapshot = JSON.stringify({ version: 1, tasks }, null, 2)
    writeChain = writeChain.then(async () => {
      try {
        await fs.mkdir(dirname(file), { recursive: true, mode: 0o700 })
        const temp = `${file}.tmp-${process.pid}`
        await fs.writeFile(temp, snapshot, { mode: 0o600 })
        await fs.rename(temp, file)
      } catch (error) {
        log.error(`feishu-scheduler: failed to persist ${file}: ${String(error)}`)
      }
    })
    return writeChain
  }

  return { load, create, list, cancel, due, retry }
}
