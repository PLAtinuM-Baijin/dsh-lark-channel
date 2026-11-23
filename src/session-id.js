/** 主人私聊的每日会话 id：<prefix><ownerChatId>-YYYYMMDD。 */
export function isOwnerSessionId(sessionId, { sessionPrefix, ownerChatId }) {
  if (ownerChatId === '' || typeof sessionId !== 'string') return false
  const stem = `${sessionPrefix}${ownerChatId}-`
  if (!sessionId.startsWith(stem)) return false
  return /^\d{8}$/.test(sessionId.slice(stem.length))
}
