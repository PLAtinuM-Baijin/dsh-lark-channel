import { QUOTE_TEXT_LIMIT } from './constants.js'
import { safeFileName } from './lark-utils.js'
import { clip } from './text-utils.js'

/** 本地历史里只存可读的正文；附件用占位符，避免把 meta 提示也记进去。 */
export function historyTextOfInbound(inbound) {
  const base = historyTextOfKind(inbound)
  return inbound.quoteId === undefined ? base : `[引用一条消息] ${base}`
}

function historyTextOfKind(inbound) {
  switch (inbound.kind) {
    case 'text':
      return inbound.text
    case 'post':
      if (inbound.text === '') return '[图片]'
      return inbound.imageKeys.length === 0 ? inbound.text : `${inbound.text} [图片]`
    case 'file':
      return `[文件] ${safeFileName(inbound.fileName) || '未命名'}`
    case 'image':
      return '[图片]'
    case 'audio':
      return '[语音]'
    case 'media':
      return '[视频]'
    case 'merge_forward':
      return '[合并转发聊天记录]'
    default:
      return inbound.text
  }
}

/**
 * 从卡片 JSON 里尽量收集可读文字：兼容 message.get 的「接收结构」
 * （title + 二维 elements，元素带 tag/text），以及卡片原始 DSL 1.0/2.0
 * （header.title、div/markdown 的 text.content、button/note/column 等）。
 * 只收文字和少量占位符，不还原卡片样式；提取不到时返回空串。
 */
export function cardText(content) {
  const parts = []
  const seen = new WeakSet()
  const push = (value) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text !== '') parts.push(text)
  }
  const walk = (node, depth) => {
    if (node === null || typeof node !== 'object' || depth > 12) return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    const tag = typeof node.tag === 'string' ? node.tag : ''
    if (tag === 'img' || tag === 'img_combination') {
      parts.push('[图片]')
      return
    }
    if (tag === 'hr') return
    if (tag === 'at') {
      push(typeof node.user_name === 'string' && node.user_name !== '' ? node.user_name : '[某人]')
      return
    }
    if ((tag === 'plain_text' || tag === 'lark_md' || tag === 'markdown') && typeof node.content === 'string') {
      push(node.content)
      return
    }
    push(node.text)
    push(node.title)
    push(node.content)
    push(node.markdown)
    for (const value of Object.values(node)) walk(value, depth + 1)
  }
  walk(content, 0)
  return parts.join('\n')
}

/** 把「获取指定消息的内容」返回的一条消息渲染成文字；图片另给出 key 供下载。 */
export function messageItemText(item) {
  const content = parseJson(item.body?.content) ?? {}
  switch (item.msg_type) {
    case 'text': {
      const text = parseText(item.body?.content, item.mentions)
      return { text: text === '' ? '[空消息]' : text, imageKeys: [] }
    }
    case 'post': {
      const { text, imageKeys } = parsePost(item.body?.content, item.mentions)
      return {
        text: text === '' && imageKeys.length > 0 ? `[富文本，含 ${imageKeys.length} 张图片]` : text,
        imageKeys,
      }
    }
    case 'image': {
      const imageKey = typeof content.image_key === 'string' ? content.image_key : undefined
      return { text: '[图片]', imageKeys: imageKey === undefined ? [] : [imageKey] }
    }
    case 'file':
      return { text: `[文件「${safeFileName(content.file_name) || '未命名'}」]`, imageKeys: [] }
    case 'audio':
      return { text: '[语音]', imageKeys: [] }
    case 'media':
      return { text: '[视频]', imageKeys: [] }
    case 'merge_forward':
      return { text: '[合并转发的聊天记录]', imageKeys: [] }
    case 'sticker':
      return { text: '[表情]', imageKeys: [] }
    case 'share_chat':
      return { text: '[群名片]', imageKeys: [] }
    case 'share_user':
      return { text: '[个人名片]', imageKeys: [] }
    case 'interactive': {
      const text = clip(cardText(content), QUOTE_TEXT_LIMIT)
      return { text: text === '' ? '[卡片消息（没有可读文本）]' : `[卡片消息]\n${text}`, imageKeys: [] }
    }
    default:
      return { text: `[${item.msg_type ?? '未知'}消息]`, imageKeys: [] }
  }
}

/** 飞书 text 消息的 content 是 JSON 字符串；群聊 @ 会留 `@_user_N` 占位符，用 mentions 还原。 */
export function parseText(content, mentions) {
  const text = parseJson(content)?.text ?? ''
  let restored = String(text)
  for (const mention of mentions ?? []) {
    if (mention?.key) restored = restored.replaceAll(mention.key, mention.name ?? '')
  }
  return restored.trim()
}

/** 富文本（post）收上来是 {title, content:[[{tag,...}]]}；拼回纯文本，并收集内嵌图片的 key。 */
export function parsePost(content, mentions) {
  const data = parseJson(content)
  const imageKeys = []
  if (data === undefined) return { text: '', imageKeys }
  const lines = []
  if (typeof data.title === 'string' && data.title.trim() !== '') lines.push(data.title.trim())
  for (const row of Array.isArray(data.content) ? data.content : []) {
    if (!Array.isArray(row)) continue
    const parts = []
    for (const element of row) {
      if (element === null || typeof element !== 'object') continue
      if (typeof element.text === 'string') parts.push(element.text)
      else if (element.tag === 'at') parts.push(`@${element.user_name ?? ''}`)
      else if (element.tag === 'img') {
        parts.push('[图片]')
        if (typeof element.image_key === 'string') imageKeys.push(element.image_key)
      } else if (element.tag === 'media') parts.push('[视频]')
      else if (element.tag === 'emotion') parts.push('[表情]')
    }
    lines.push(parts.join(''))
  }
  let text = lines.join('\n').trim()
  for (const mention of mentions ?? []) {
    if (mention?.key) text = text.replaceAll(mention.key, mention.name ?? '')
  }
  return { text, imageKeys }
}

export function parseJson(content) {
  try {
    const value = JSON.parse(content ?? '{}')
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}
