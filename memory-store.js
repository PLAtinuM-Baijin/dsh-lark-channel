/**
 * 飞书长期记忆的 Markdown 存储层。
 *
 * 目录结构（FEISHU_MEMORY_DIR，默认 ~/.dsh-feishu-memory）：
 *   global.md          ## Persona / ## User profile / ## Facts
 *   chats/<chat_id>.md ## Facts
 *
 * 所有写操作走模块级串行队列（同一进程内不会互相踩），写入用临时文件 + rename
 * 原子替换。读操作按 mtime 缓存，因为 memory-context 在每次组装提示词时都要同步读。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const SECTION_TITLES = { persona: 'Persona', user: 'User profile', facts: 'Facts' }
const GLOBAL_TITLES = ['Persona', 'User profile', 'Facts']

const MAX_ENTRY_CHARS = 500
const MAX_ENTRIES = {
  global: { Persona: 20, 'User profile': 40, Facts: 60 },
  chat: { Facts: 30 },
}
const MAX_BYTES = { global: 16 * 1024, chat: 8 * 1024 }
export const RENDER_LIMITS = { global: 2000, chat: 1500 }

const CHAT_ID = /^oc_[A-Za-z0-9]+$/

let rootDir = process.env.FEISHU_MEMORY_DIR?.trim() || path.join(os.homedir(), '.dsh-feishu-memory')
let writeChain = Promise.resolve()
const cache = new Map()

export function memoryDir() {
  return rootDir
}

export function setMemoryDir(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return
  const next = dir.trim()
  if (next === rootDir) return
  rootDir = next
  cache.clear()
}

export function isValidChatId(chatId) {
  return typeof chatId === 'string' && CHAT_ID.test(chatId)
}

export function isValidSection(section) {
  return Object.hasOwn(SECTION_TITLES, section)
}

// --- 时间 ---------------------------------------------------------------

let dateFormatter
function todayStamp() {
  if (dateFormatter === undefined) {
    dateFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.FEISHU_MEMORY_TZ?.trim() || 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
  }
  return dateFormatter.format(new Date())
}

// --- 路径与解析 ---------------------------------------------------------

function globalFile() {
  return path.join(rootDir, 'global.md')
}

function chatFile(chatId) {
  return path.join(rootDir, 'chats', `${chatId}.md`)
}

function emptySections() {
  return { Persona: [], 'User profile': [], Facts: [] }
}

function cloneSections(sections) {
  const copy = emptySections()
  for (const title of GLOBAL_TITLES) {
    copy[title] = (sections[title] ?? []).map((entry) => ({ ...entry }))
  }
  return copy
}

function parseMarkdown(text) {
  const sections = emptySections()
  let current
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading !== null) {
      const title = heading[1].trim()
      current = Object.hasOwn(sections, title) ? title : undefined
      continue
    }
    if (current === undefined) continue
    const item = /^-\s+\[(\d{4}-\d{2}-\d{2})\]\s+(.+)$/.exec(line)
    if (item !== null) sections[current].push({ date: item[1], text: item[2].trim() })
  }
  return sections
}

/** 同步读 + mtime 缓存；文件不存在或损坏时返回空结构，不抛。 */
function readSections(file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    cache.delete(file)
    return emptySections()
  }
  const cached = cache.get(file)
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.sections
  }
  let sections
  try {
    sections = parseMarkdown(fs.readFileSync(file, 'utf8'))
  } catch {
    sections = emptySections()
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, sections })
  return sections
}

// --- 序列化与上限 -------------------------------------------------------

function serialize(kind, sections, chatId) {
  const titles = kind === 'global' ? GLOBAL_TITLES : ['Facts']
  const lines = [kind === 'global' ? '# 飞书长期记忆（全局）' : `# 飞书长期记忆（会话 ${chatId}）`]
  for (const title of titles) {
    lines.push('', `## ${title}`)
    for (const entry of sections[title] ?? []) lines.push(`- [${entry.date}] ${entry.text}`)
  }
  return `${lines.join('\n')}\n`
}

function countEntries(sections) {
  return GLOBAL_TITLES.reduce((sum, title) => sum + (sections[title]?.length ?? 0), 0)
}

/** 条数、字节上限；超出时从最旧的事实开始丢。chat 只保留 Facts。 */
function applyCaps(kind, sections, chatId) {
  let trimmed = false
  const limits = MAX_ENTRIES[kind]
  for (const [title, max] of Object.entries(limits)) {
    const list = sections[title] ?? []
    if (list.length > max) {
      list.splice(0, list.length - max)
      trimmed = true
    }
  }
  if (kind === 'chat') {
    for (const title of GLOBAL_TITLES) {
      if (title !== 'Facts' && sections[title]?.length) {
        sections[title] = []
        trimmed = true
      }
    }
  }
  const order = kind === 'global' ? ['Facts', 'User profile', 'Persona'] : ['Facts']
  let text = serialize(kind, sections, chatId)
  while (Buffer.byteLength(text, 'utf8') > MAX_BYTES[kind]) {
    let dropped = false
    for (const title of order) {
      if (sections[title]?.length) {
        sections[title].shift()
        dropped = true
        trimmed = true
        break
      }
    }
    if (!dropped) break
    text = serialize(kind, sections, chatId)
  }
  return { sections, trimmed }
}

function renderSections(sections, titles, limit, dropOrder) {
  const copy = {}
  for (const title of titles) copy[title] = [...(sections[title] ?? [])]
  const build = () =>
    titles
      .filter((title) => copy[title].length > 0)
      .map((title) => `## ${title}\n${copy[title].map((entry) => `- [${entry.date}] ${entry.text}`).join('\n')}`)
      .join('\n\n')
  let text = build()
  while (text.length > limit) {
    let dropped = false
    for (const title of dropOrder) {
      if (copy[title].length > 0) {
        copy[title].shift()
        dropped = true
        break
      }
    }
    if (!dropped) break
    text = build()
  }
  return text
}

// --- 写队列与原子写 -----------------------------------------------------

function enqueue(task) {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function writeSectionsAtomic(file, kind, sections, chatId) {
  const dir = path.dirname(file)
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  const text = serialize(kind, sections, chatId)
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await fsp.writeFile(tmp, text, { mode: 0o600 })
  await fsp.rename(tmp, file)
  await fsp.chmod(file, 0o600).catch(() => undefined)
  cache.delete(file)
}

// --- 对外 API -----------------------------------------------------------

/** 单行化、压掉控制字符、限制长度；记忆条目不允许带换行。 */
export function normalizeText(text) {
  const flat = Array.from(String(text ?? ''))
    .map((char) => {
      const code = char.codePointAt(0)
      return code < 0x20 || code === 0x7f ? ' ' : char
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(flat)
  return chars.length > MAX_ENTRY_CHARS ? chars.slice(0, MAX_ENTRY_CHARS).join('') : flat
}

export function renderGlobal(limit = RENDER_LIMITS.global) {
  return renderSections(readSections(globalFile()), GLOBAL_TITLES, limit, ['Facts', 'User profile', 'Persona'])
}

export function renderChat(chatId, limit = RENDER_LIMITS.chat) {
  if (!isValidChatId(chatId)) return ''
  return renderSections(readSections(chatFile(chatId)), ['Facts'], limit, ['Facts'])
}

export function listGlobal(section) {
  const sections = readSections(globalFile())
  return pickEntries(sections, section === undefined ? GLOBAL_TITLES : [SECTION_TITLES[section]])
}

export function listChat(chatId, section = 'facts') {
  if (!isValidChatId(chatId)) return []
  const sections = readSections(chatFile(chatId))
  return pickEntries(sections, [SECTION_TITLES[section]])
}

function pickEntries(sections, titles) {
  const out = []
  for (const title of titles) {
    for (const entry of sections[title] ?? []) out.push({ section: title, date: entry.date, text: entry.text })
  }
  return out
}

export async function remember({ scope, chatId, section, text }) {
  const clean = normalizeText(text)
  if (clean === '') throw new Error('记忆内容为空')
  if (scope === 'chat') {
    if (!isValidChatId(chatId)) throw new Error('无效的 chatId')
    if (section !== 'facts') throw new Error('chat 记忆只支持 facts')
  } else if (scope === 'global') {
    if (!isValidSection(section)) throw new Error('无效的 section')
  } else {
    throw new Error('无效的 scope')
  }

  const file = scope === 'global' ? globalFile() : chatFile(chatId)
  const kind = scope === 'global' ? 'global' : 'chat'
  return enqueue(async () => {
    const sections = cloneSections(readSections(file))
    const title = SECTION_TITLES[section]
    const list = sections[title]
    const duplicate = list.some((entry) => entry.text.toLowerCase() === clean.toLowerCase())
    if (!duplicate) list.push({ date: todayStamp(), text: clean })
    const capped = applyCaps(kind, sections, scope === 'chat' ? chatId : undefined)
    await writeSectionsAtomic(file, kind, capped.sections, scope === 'chat' ? chatId : undefined)
    return {
      added: !duplicate,
      duplicate,
      trimmed: capped.trimmed,
      totalEntries: countEntries(capped.sections),
    }
  })
}

export async function forget({ scope, chatId, section, text }) {
  const needle = normalizeText(text).toLowerCase()
  if (needle === '') throw new Error('要删除的内容为空')
  if (scope === 'chat') {
    if (!isValidChatId(chatId)) throw new Error('无效的 chatId')
    if (section !== 'facts') throw new Error('chat 记忆只支持 facts')
  } else if (scope === 'global') {
    if (!isValidSection(section)) throw new Error('无效的 section')
  } else {
    throw new Error('无效的 scope')
  }

  const file = scope === 'global' ? globalFile() : chatFile(chatId)
  const kind = scope === 'global' ? 'global' : 'chat'
  return enqueue(async () => {
    const sections = cloneSections(readSections(file))
    const title = SECTION_TITLES[section]
    const before = sections[title]
    sections[title] = before.filter((entry) => !entry.text.toLowerCase().includes(needle))
    const removed = before.length - sections[title].length
    const capped = applyCaps(kind, sections, scope === 'chat' ? chatId : undefined)
    await writeSectionsAtomic(file, kind, capped.sections, scope === 'chat' ? chatId : undefined)
    return {
      removed,
      trimmed: capped.trimmed,
      totalEntries: countEntries(capped.sections),
    }
  })
}
