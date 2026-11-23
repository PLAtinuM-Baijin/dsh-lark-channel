/**
 * 本地聊天历史缓存。
 *
 * 每个 chat 一个 JSONL 文件，记录用户与机器人发出的可见消息（含飞书 message_id），
 * 供每轮请求注入「最近聊天记录」，让模型知道每句话对应哪条消息，
 * 从而自己决定这一轮是引用回复，还是直接发一条新消息。
 *
 * 只用本地文件，不调用飞书的历史消息接口（不需要额外权限）。
 * systemPrompt.context 的 text 必须是同步函数，所以读取走内存缓存 +
 * readFileSync 懒加载；写入走串行队列 + 临时文件 rename。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 每个 chat 最多保留多少条；超过后保留最新的 KEEP_ENTRIES 条。 */
export const MAX_ENTRIES = 400
const KEEP_ENTRIES = 200
/** 单条历史文本的长度上限；注入时还会再截断。 */
export const ENTRY_TEXT_LIMIT = 500
const DEFAULT_TIME_ZONE = 'Asia/Shanghai'
const CHAT_ID = /^oc_[A-Za-z0-9]+$/

let state = createState(defaultDir())
let formatter
let formatterZone = ''

function createState(dir) {
  return {
    dir,
    timeZone: DEFAULT_TIME_ZONE,
    chats: new Map(),
    chains: new Map(),
    authoritative: false,
    log: (message) => console.warn(message),
  }
}

function defaultDir() {
  const fromEnv = typeof process.env.FEISHU_HISTORY_DIR === 'string' ? process.env.FEISHU_HISTORY_DIR.trim() : ''
  return fromEnv === '' ? join(homedir(), '.dsh-feishu-history') : fromEnv
}

/**
 * 配置历史目录与展示时区。
 * authoritative=true 由 channel 调用（Host 配置优先）；preset 里的注入插件
 * 只做兜底配置，避免把 channel 显式配置的目录覆盖回默认值。
 */
export function configureHistory(options = {}) {
  const requested = typeof options.dir === 'string' ? options.dir.trim() : ''
  if (options.authoritative) {
    state.authoritative = true
    setDir(requested === '' ? defaultDir() : requested)
  } else if (!state.authoritative) {
    setDir(requested === '' ? defaultDir() : requested)
  }
  const zone = typeof options.timeZone === 'string' && options.timeZone.trim() !== '' ? options.timeZone.trim() : ''
  if (zone !== '' && zone !== state.timeZone) {
    state.timeZone = zone
    formatter = undefined
    formatterZone = ''
  }
  if (typeof options.log === 'function') state.log = options.log
  return state.dir
}

function setDir(dir) {
  if (dir === state.dir) return
  state.dir = dir
  state.chats.clear()
  state.chains.clear()
}

export function historyDir() {
  return state.dir
}

function fileFor(chatId) {
  return join(state.dir, `${chatId}.jsonl`)
}

function timeFormatter() {
  if (formatter !== undefined && formatterZone === state.timeZone) return formatter
  formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: state.timeZone,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  formatterZone = state.timeZone
  return formatter
}

function normalizeEntry(value) {
  if (value === null || typeof value !== 'object') return undefined
  if (typeof value.id !== 'string' || value.id === '') return undefined
  if (typeof value.text !== 'string') return undefined
  const text = clipLine(value.text)
  if (text === '') return undefined
  const at = Number.isFinite(value.at) ? value.at : 0
  const from = value.from === 'bot' ? 'bot' : 'user'
  return { id: value.id, at, from, text }
}

function clipLine(text) {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, ENTRY_TEXT_LIMIT).join('')
}

/** 懒加载：同步读文件，保证 systemPrompt.context 能同步拿到内容。 */
function loadChat(chatId) {
  const cached = state.chats.get(chatId)
  if (cached !== undefined) return cached

  const list = []
  try {
    const raw = fs.readFileSync(fileFor(chatId), 'utf8')
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        const entry = normalizeEntry(JSON.parse(line))
        if (entry !== undefined) list.push(entry)
      } catch {
        // 写入中途崩溃会留下半行；跳过即可。
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') state.log(`feishu-history: failed to read ${fileFor(chatId)}: ${String(error)}`)
  }
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - KEEP_ENTRIES)
  state.chats.set(chatId, list)
  return list
}

function enqueue(chatId, task) {
  const previous = state.chains.get(chatId) ?? Promise.resolve()
  const next = previous
    .then(task)
    .catch((error) => state.log(`feishu-history: write failed for ${chatId}: ${String(error)}`))
  state.chains.set(chatId, next)
  void next.finally(() => {
    if (state.chains.get(chatId) === next) state.chains.delete(chatId)
  })
}

async function writeAll(chatId, list) {
  await fsp.mkdir(state.dir, { recursive: true, mode: 0o700 })
  const path = fileFor(chatId)
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  const body = list.length === 0 ? '' : `${list.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  await fsp.writeFile(temp, body, { mode: 0o600 })
  await fsp.rename(temp, path)
}

/** 记录一条消息；同一 message_id 只记一次。内存立即更新，文件异步落盘。 */
export function recordMessage(chatId, entry) {
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return false
  const normalized = normalizeEntry({
    id: entry?.id,
    at: entry?.at ?? Date.now(),
    from: entry?.from,
    text: entry?.text ?? '',
  })
  if (normalized === undefined) return false

  const list = loadChat(chatId)
  if (list.some((item) => item.id === normalized.id)) return false
  list.push(normalized)
  if (list.length > MAX_ENTRIES) list.splice(0, list.length - KEEP_ENTRIES)
  // 每 chat 消息量很小，直接整文件重写，避免追加与轮转交错的边界情况。
  enqueue(chatId, () => writeAll(chatId, [...list]))
  return true
}

/** 撤回时从历史里删掉，避免之后还引用一条已不存在的消息。 */
export function removeMessage(chatId, messageId) {
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return false
  if (typeof messageId !== 'string' || messageId === '') return false
  const list = loadChat(chatId)
  const index = list.findIndex((item) => item.id === messageId)
  if (index < 0) return false
  list.splice(index, 1)
  enqueue(chatId, () => writeAll(chatId, [...list]))
  return true
}

export function hasMessage(chatId, messageId) {
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return false
  if (typeof messageId !== 'string' || messageId === '') return false
  return loadChat(chatId).some((item) => item.id === messageId)
}

/** 最近 maxEntries 条，超过 maxChars 时从最旧的开始丢；每条正文最多 entryChars 字。 */
export function renderHistory(chatId, options = {}) {
  if (typeof chatId !== 'string' || !CHAT_ID.test(chatId)) return ''
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, options.maxEntries) : 5
  const maxChars = Number.isFinite(options.maxChars) ? Math.max(10, options.maxChars) : 800
  const entryChars = Number.isFinite(options.entryChars) ? Math.max(10, options.entryChars) : 100
  const list = loadChat(chatId)
  const lines = []
  let chars = 0
  for (let i = list.length - 1; i >= 0 && lines.length < maxEntries; i -= 1) {
    const line = formatEntry(list[i], entryChars)
    if (lines.length > 0 && chars + line.length + 1 > maxChars) break
    lines.push(line)
    chars += line.length + 1
  }
  return lines.reverse().join('\n')
}

function formatEntry(entry, entryChars) {
  const who = entry.from === 'bot' ? '机器人' : '用户'
  const time = timeFormatter().format(new Date(entry.at === 0 ? Date.now() : entry.at))
  return `[${time}] ${who} (${entry.id})：${clipText(entry.text, entryChars)}`
}

function clipText(text, limit) {
  const chars = Array.from(text)
  if (chars.length <= limit) return text
  return `${chars.slice(0, limit).join('')}…`
}
