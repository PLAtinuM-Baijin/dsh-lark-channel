export function shorten(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

/** 交给模型的长正文截断：末尾明说还有内容，避免模型把截断处当成全文结尾。 */
export function clip(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}…（过长，已截断）`
}

export function split(text, size) {
  const chars = Array.from(text)
  const out = []
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''))
  return out.length === 0 ? [''] : out
}
