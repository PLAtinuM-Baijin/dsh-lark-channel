/**
 * 出站：引用回复、主动消息与失败兜底。
 * 默认直发（im.message.create）；模型显式选择引用时才用 reply，
 * 引用目标被撤回/删除导致 reply 失败时，自动改发一条不引用的新消息。
 */
import { REPLY_CHUNK } from './constants.js'
import { recordMessage } from './history-store.js'
import { checkLark } from './lark-utils.js'
import { split } from './text-utils.js'

/**
 * 这一轮当前的发送目标：
 *   { replyTo } —— 引用回复某条消息；replyTo 为空表示直接发新消息；
 *   undefined   —— 没有可发送的东西（非主动轮且没有触发消息）。
 * 默认直发，只有模型显式选择 reply 才引用。
 */
export function outboundTarget(state) {
  if (state.delivery?.mode === 'direct') return { replyTo: undefined }
  if (state.delivery?.mode === 'reply') {
    const replyTo = state.delivery.replyTo ?? state.replyTo
    return replyTo === undefined ? { replyTo: undefined } : { replyTo }
  }
  if (state.proactive) return { replyTo: undefined }
  return state.replyTo === undefined ? undefined : { replyTo: undefined }
}

export function createOutbound({ client, log }) {
  /**
   * 引用回复。chatId 用于兜底：引用目标被撤回/删除时，reply 会失败，
   * 这时改发一条不引用的新消息，而不是把整条回复吞掉。
   */
  async function sendText(messageId, text, chatId) {
    const messageIds = []
    for (const chunk of split(text, REPLY_CHUNK)) {
      let res
      try {
        res = checkLark(await client.im.message.reply({
          path: { message_id: messageId },
          data: {
            // msg_type=post 的 md 节点：飞书按 CommonMark + GFM 渲染 Markdown。
            msg_type: 'post',
            content: JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: chunk }]] } }),
          },
        }))
      } catch (error) {
        if (chatId === undefined) throw error
        const line = `feishu-channel: reply to ${messageId} failed; sending directly: ${String(error)}`
        log.warn(line)
        console.warn(line)
        res = checkLark(await client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'post',
            content: JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: chunk }]] } }),
          },
        }))
      }
      const sentId = res?.data?.message_id
      if (typeof sentId === 'string' && sentId !== '') {
        messageIds.push(sentId)
        recordMessage(chatId, { id: sentId, at: Date.now(), from: 'bot', text: chunk })
      }
    }
    return messageIds
  }

  /** 主动消息：不引用任何消息，直接发到 chat_id。 */
  async function sendChatText(chatId, text) {
    const messageIds = []
    for (const chunk of split(text, REPLY_CHUNK)) {
      const res = checkLark(await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'post',
          content: JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: chunk }]] } }),
        },
      }))
      const messageId = res?.data?.message_id
      if (typeof messageId === 'string' && messageId !== '') {
        messageIds.push(messageId)
        recordMessage(chatId, { id: messageId, at: Date.now(), from: 'bot', text: chunk })
      }
    }
    return messageIds
  }

  async function sendTextSafe(messageId, text, chatId) {
    try {
      await sendText(messageId, text, chatId)
    } catch (error) {
      log.warn(`feishu-channel: failed to send fallback text for ${messageId}: ${String(error)}`)
      console.warn(`feishu-channel: failed to send fallback text for ${messageId}: ${String(error)}`)
    }
  }

  async function sendChatTextSafe(chatId, text) {
    try {
      await sendChatText(chatId, text)
    } catch (error) {
      log.warn(`feishu-channel: failed to send proactive text to ${chatId}: ${String(error)}`)
      console.warn(`feishu-channel: failed to send proactive text to ${chatId}: ${String(error)}`)
    }
  }

  /** 超时/出错提示：按这一轮当前选定的发送方式发。 */
  function sendTurnNotice(state, text) {
    const target = outboundTarget(state)
    if (target === undefined) return Promise.resolve()
    return target.replyTo !== undefined ? sendText(target.replyTo, text, state.chatId) : sendChatText(state.chatId, text)
  }

  return { sendText, sendChatText, sendTextSafe, sendChatTextSafe, sendTurnNotice }
}
