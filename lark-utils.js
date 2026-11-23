import fs from 'node:fs/promises'
import { IMAGE_EXTENSIONS, IMAGE_FILE_TYPES, IMAGE_MEDIA_TYPES, TEXT_FILE_TYPES } from './constants.js'

export function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** 图片格式判定：先看 Content-Type，再看文件名后缀，最后嗅探文件头。 */
export function imageMediaType(contentType, buffer, name = '') {
  if (IMAGE_MEDIA_TYPES.has(contentType)) return contentType
  const byName = IMAGE_FILE_TYPES.get(extensionOf(name))
  if (byName !== undefined) return byName
  if (buffer.length >= 12) {
    const head = buffer.subarray(0, 12).toString('latin1')
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  }
  return undefined
}

export function isTextFile(name, contentType) {
  return contentType.startsWith('text/') || TEXT_FILE_TYPES.has(extensionOf(name))
}

/** 归档文件名：消息 id + 序号 + 净化后的原名，避免重名和路径穿越。 */
export function historyName(messageId, index, name, mediaType = '') {
  const safe = safeFileName(name)
  if (safe !== '') return `${messageId}-${index}-${safe}`
  const ext = IMAGE_EXTENSIONS.get(mediaType)
  return ext === undefined ? `${messageId}-${index}.bin` : `${messageId}-${index}.${ext}`
}

export function safeFileName(name) {
  if (typeof name !== 'string' || name === '') return ''
  const base = name.split(/[\\/]/).pop() ?? ''
  return base.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '').slice(0, 120)
}

export function mimeSuffix(contentType) {
  return contentType === '' ? '' : `，${contentType}`
}

/** 只读文件开头；群聊内联文本文件时用，不把整个文件读进内存。 */
export async function readTextPrefix(path, limit) {
  const handle = await fs.open(path, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** 把 SDK 返回的二进制流读进内存；超过上限直接中断，防止超大文件撑爆进程。 */
export async function streamToBuffer(stream, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > limit) {
      stream.destroy?.()
      throw new Error(`resource exceeds ${limit} bytes`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** 把 Lark SDK 的错误变成可读原因；HTTP 4xx 的响应体是流，需要先读完再解析。 */
export async function describeLarkError(error) {
  const status = error?.response?.status
  const payload = await readErrorBody(error?.response?.data)
  if (payload !== undefined) {
    if (payload.code !== undefined || payload.msg !== undefined) {
      const prefix = status === undefined ? '飞书 API' : `飞书 API ${status}`
      return `${prefix}：${payload.code ?? 'unknown'} ${payload.msg ?? ''}`.trim()
    }
    if (typeof payload.text === 'string') {
      return status === undefined ? payload.text : `HTTP ${status}: ${payload.text}`
    }
  }
  return errorText(error)
}

/** 错误响应可能是 Buffer、字符串或流；统一读成 JSON 对象或纯文本。 */
async function readErrorBody(data) {
  if (data === undefined || data === null) return undefined
  if (typeof data === 'string') return parseErrorText(data)
  if (Buffer.isBuffer(data)) return parseErrorText(data.toString('utf8'))
  if (typeof data !== 'object') return undefined
  if (data.code !== undefined || data.msg !== undefined) return data
  if (typeof data[Symbol.asyncIterator] !== 'function') return undefined

  const chunks = []
  let total = 0
  try {
    for await (const chunk of data) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      chunks.push(buffer)
      if (total >= 64 * 1024) {
        data.destroy?.()
        break
      }
    }
  } catch {
    return undefined
  }
  return parseErrorText(Buffer.concat(chunks).toString('utf8'))
}

function parseErrorText(text) {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    const value = JSON.parse(trimmed)
    if (value !== null && typeof value === 'object') return value
  } catch {
    // 不是 JSON，就按纯文本原因处理。
  }
  return { text: trimmed.slice(0, 500) }
}

export function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Lark SDK 把业务错误放在响应体的 code/msg 里，HTTP 200 也可能是失败。 */
export function checkLark(res) {
  if (res?.code !== undefined && res.code !== 0) throw new Error(`Lark API ${res.code}: ${res.msg ?? ''}`)
  return res
}
