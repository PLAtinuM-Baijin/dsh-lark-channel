/**
 * 网页端 → 飞书的镜像。
 *
 * 主人在 dsh web 面板里打开主人私聊的飞书会话时（消息 source 带 rpcId），
 * 把网页问题以「[user asked from web] …」单独发一条，再把助手每一步可见文本
 * 按顺序转发到飞书。只做事件转发，不触发模型、不建流式卡片。
 *
 * 只在两种情况下生效：主人私聊的每日飞书会话（含往日）、且该轮不是 channel
 * 驱动的（channel 驱动的轮次本来就发飞书，不能再镜像一遍）。
 * 网页里额外新建的普通会话不在这个范围里。
 */
import { DELIVERED_LIMIT, WEB_MIRROR_QUESTION_LIMIT } from './constants.js'

const BLOCK_PLACEHOLDERS = { image: '[图片]', file: '[文件]', audio: '[语音]', video: '[视频]' }

export function createWebMirror({ config, log, sendChatText, assistantText, isOwnerSession }) {
  /** state -> 该 state 的镜像发送链，保证问题先于回答、多条回答按序到达。 */
  const chains = new WeakMap()
  /** state -> { token }：网页轮次进行中才镜像助手文本；轮次结束自动失效。 */
  const activity = new WeakMap()
  /** 已镜像过的问题 message_id，取消重排后被再次领取时不重复发。 */
  const mirrored = new Set()
  let tokenSeq = 0

  function onClaimed(state, message, agent) {
    if (!config.syncWebToFeishu.get()) return
    if (message?.source?.rpcId === undefined) return
    if (!isOwnerSession(state)) return

    const id = typeof message?.id === 'string' ? message.id : ''
    if (id === '' || !mirrored.has(id)) {
      if (id !== '') {
        mirrored.add(id)
        if (mirrored.size > DELIVERED_LIMIT) mirrored.delete(mirrored.values().next().value)
      }
      const text = webQuestionText(message?.content)
      if (text !== '') queueSend(state, `[user asked from web] ${clipQuestion(text)}`)
    }
    markActive(state, agent)
  }

  function onAssistantEnd(state, frame) {
    if (!config.syncWebToFeishu.get()) return
    if (!isOwnerSession(state)) return
    if (state.driving) return
    if (activity.get(state) === undefined) return

    const outcome = frame?.outcome
    if (outcome?.kind !== 'committed' || outcome?.eventType !== 'assistant/message') return
    const seq = outcome.seq
    if (!Number.isSafeInteger(seq) || state.delivered.has(seq)) return

    const agent = state.agent
    if (agent === undefined) return
    const [event] = agent.session.snapshotEvents(seq, seq + 1)
    if (event === undefined || event.type !== 'assistant/message') return
    const text = assistantText(event)
    if (text === '') return

    // 记进 delivered：万一随后 channel 也开始驱动同一轮，不会重复发。
    state.delivered.add(seq)
    if (state.delivered.size > DELIVERED_LIMIT) state.delivered.delete(state.delivered.keys().next().value)
    queueSend(state, text)
  }

  function markActive(state, agent) {
    const token = ++tokenSeq
    activity.set(state, { token })
    const idle = agent !== undefined && typeof agent.whenIdle === 'function' ? agent.whenIdle() : Promise.resolve()
    Promise.resolve(idle)
      .catch(() => undefined)
      .then(() => {
        if (activity.get(state)?.token === token) activity.delete(state)
      })
  }

  function queueSend(state, text) {
    const previous = chains.get(state) ?? Promise.resolve()
    const next = previous
      .then(() => sendChatText(config.ownerChatId, text))
      .catch((error) => {
        const line = `feishu-channel: failed to mirror web turn to Feishu: ${String(error)}`
        log.warn(line)
        console.warn(line)
      })
    chains.set(state, next)
  }

  return { onClaimed, onAssistantEnd }
}

/** 网页用户消息的 content 块 → 可读文本；图片等只留占位符。 */
export function webQuestionText(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (typeof block?.type === 'string') parts.push(BLOCK_PLACEHOLDERS[block.type] ?? `[${block.type}]`)
  }
  return parts.join('\n').trim()
}

export function clipQuestion(text) {
  const chars = Array.from(text)
  return chars.length <= WEB_MIRROR_QUESTION_LIMIT ? text : `${chars.slice(0, WEB_MIRROR_QUESTION_LIMIT).join('')}…`
}
