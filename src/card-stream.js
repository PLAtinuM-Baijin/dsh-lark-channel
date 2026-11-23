/**
 * 流式卡片：chunk 帧驱动 CardKit 卡片的打字机更新，end 帧收尾成终稿；
 * 建卡/更新失败或正文超长时退回普通富文本消息，绝不让回复卡死。
 * 卡片句柄挂在 state.cards 上，所有发送/收尾操作都按同一出站链串行。
 */
import {
  CARD_ELEMENT_ID,
  CARD_PRINT_INTERVAL_MS,
  CARD_PRINT_RATE,
  CARD_PRINT_STEP,
  CARD_PUSH_INTERVAL_MS,
  CARD_TEXT_LIMIT,
} from './constants.js'
import { recordMessage } from './history-store.js'
import { checkLark } from './lark-utils.js'

export function createCardStream({
  client,
  log,
  config,
  outboundTarget,
  sendTextSafe,
  sendChatTextSafe,
  deliver,
  touchDeadline,
  assistantText,
}) {
  /**
   * 模型还在生成：把 text-delta 累积进该 attempt 的卡片句柄，按节流推送累计全文。
   * 第一段文本到达时才建卡，纯工具步骤不会产生卡片。
   */
  function onAssistantChunk(state, frame) {
    if (!config.cardStreaming.get() || !state.driving) return
    const chunk = frame?.chunk
    if (chunk?.type !== 'text-delta' || typeof chunk.text !== 'string' || chunk.text === '') return
    if (state.agent === undefined) return
    const target = outboundTarget(state)
    if (target === undefined) return

    let handle = state.cards.get(frame.attemptId)
    if (handle === undefined) {
      handle = {
        attemptId: frame.attemptId,
        replyTo: target.replyTo,
        chatId: state.chatId,
        texts: new Map(),
        cardId: undefined,
        sequence: 0,
        chain: Promise.resolve(),
        opening: undefined,
        timer: undefined,
        degraded: false,
        finalized: false,
        lastPushed: '',
        sentChars: 0,
        queueChars: 0,
        queueAt: 0,
      }
      state.cards.set(frame.attemptId, handle)
      handle.opening = openCard(state, handle)
    }
    if (handle.degraded) return

    // 卡片内容是 append-only 的累计文本，飞书按前缀判断能否继续打字机输出。
    const index = Number.isSafeInteger(chunk.index) ? chunk.index : 0
    handle.texts.set(index, (handle.texts.get(index) ?? '') + chunk.text)
    touchDeadline(state)
    scheduleCardPush(state, handle)
  }

  /** 建卡片实体并引用发送；失败就退回普通富文本，绝不让回复卡死。 */
  async function openCard(state, handle) {
    try {
      const created = checkLark(await client.cardkit.v1.card.create({
        data: { type: 'card_json', data: JSON.stringify(cardJson()) },
      }))
      const cardId = created?.data?.card_id
      if (typeof cardId !== 'string' || cardId === '') throw new Error('cardkit create returned no card_id')
      const content = JSON.stringify({ type: 'card', data: { card_id: cardId } })
      let res
      if (handle.replyTo !== undefined) {
        try {
          res = checkLark(await client.im.message.reply({
            path: { message_id: handle.replyTo },
            data: { msg_type: 'interactive', content },
          }))
        } catch (error) {
          // 引用目标可能被撤回/删除；回复失败不能把整条答案吞掉，改发一条新消息。
          const line = `feishu-channel: card reply to ${handle.replyTo} failed; sending as a new message: ${String(error)}`
          log.warn(line)
          console.warn(line)
          handle.replyTo = undefined
          res = checkLark(await client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: { receive_id: handle.chatId, msg_type: 'interactive', content },
          }))
        }
      } else {
        res = checkLark(await client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: { receive_id: handle.chatId, msg_type: 'interactive', content },
        }))
      }
      handle.cardId = cardId
      const cardMessageId = res?.data?.message_id
      handle.cardMessageId = typeof cardMessageId === 'string' && cardMessageId !== '' ? cardMessageId : undefined
      log.info(`feishu-channel: opened streaming card ${cardId} for ${state.sessionId}`)
      pushCardText(handle, renderCardText(handle))
    } catch (error) {
      handle.degraded = true
      const message = `feishu-channel: streaming card unavailable for ${state.sessionId}; using plain messages: ${String(error)}`
      log.warn(message)
      console.warn(message)
    }
  }

  function scheduleCardPush(state, handle) {
    if (handle.degraded || handle.timer !== undefined) return
    handle.timer = setTimeout(() => {
      handle.timer = undefined
      pushCardText(handle, renderCardText(handle))
    }, CARD_PUSH_INTERVAL_MS)
  }

  /** 同一张卡的所有操作共用一个严格递增的 sequence，并按链串行，避免 300317。 */
  function pushCardText(handle, text) {
    if (handle.cardId === undefined || handle.degraded || handle.finalized) return
    if (text === '' || text === handle.lastPushed) return
    handle.lastPushed = text
    const cardId = handle.cardId
    const sequence = ++handle.sequence
    handle.chain = handle.chain.then(async () => {
      try {
        checkLark(await client.cardkit.v1.cardElement.content({
          path: { card_id: cardId, element_id: CARD_ELEMENT_ID },
          data: { content: text, sequence },
        }))
        noteCardPrint(handle, text)
      } catch (error) {
        handle.degraded = true
        log.warn(`feishu-channel: streaming card update failed for ${cardId}: ${String(error)}`)
      }
    })
  }

  /** 这条 attempt 结束：卡有内容的收尾成终稿，没有卡的走普通消息路径。 */
  function onAssistantEnd(state, frame) {
    const handle = state.cards.get(frame?.attemptId)
    const outcome = frame?.outcome
    const committed = outcome?.kind === 'committed' && outcome.eventType === 'assistant/message'
    if (handle === undefined) {
      if (committed) deliver(state, outcome.seq)
      return
    }
    state.cards.delete(frame.attemptId)

    if (!committed || state.agent === undefined || !state.driving) {
      finishCard(state, handle, undefined)
      return
    }
    if (state.delivered.has(outcome.seq)) {
      finishCard(state, handle, undefined)
      return
    }
    const [event] = state.agent.session.snapshotEvents(outcome.seq, outcome.seq + 1)
    if (event === undefined || event.type !== 'assistant/message') {
      finishCard(state, handle, undefined)
      return
    }
    const text = assistantText(event)
    if (text !== '') {
      state.delivered.add(outcome.seq)
      touchDeadline(state)
    }
    finishCard(state, handle, text === '' ? undefined : { replyTo: handle.replyTo, text })
  }

  /** 卡片收尾挂进出站链，driver 的 await state.outbound 才能等到它。 */
  function finishCard(state, handle, commit) {
    state.outbound = state.outbound
      .then(() => finalizeCard(state, handle, commit))
      .catch((error) => {
        log.warn(`feishu-channel: streaming card finalize failed: ${String(error)}`)
      })
  }

  async function finalizeCard(state, handle, commit) {
    handle.finalized = true
    if (handle.timer !== undefined) {
      clearTimeout(handle.timer)
      handle.timer = undefined
    }
    // 回合可能在建卡还没回来时就结束；等建卡完成再收尾，否则会留一张空卡在“生成中”。
    if (handle.opening !== undefined) await handle.opening
    await handle.chain

    const finalText = commit?.text ?? renderCardText(handle)
    if (handle.cardId !== undefined && !handle.degraded && finalText !== '') {
      await pushFinalCardText(handle, clipText(finalText, CARD_TEXT_LIMIT))
    }
    // 关流式会把客户端还没打完的字一次性上屏；先等打印队列排空。
    if (handle.cardId !== undefined) await waitCardDrain(handle)
    // 即使中途更新失败也要尝试关流式，否则卡片会一直显示“生成中”。
    if (handle.cardId !== undefined) await closeCardStreaming(handle)

    // 卡片不可用、中途更新失败或正文超长：用普通富文本把完整文本补发。
    const tooLong = Array.from(finalText).length > CARD_TEXT_LIMIT
    const fallback = commit !== undefined && (handle.cardId === undefined || handle.degraded || tooLong)
    if (fallback) {
      if (handle.replyTo !== undefined) await sendTextSafe(handle.replyTo, commit.text, handle.chatId)
      else await sendChatTextSafe(handle.chatId, commit.text)
    } else if (commit !== undefined && handle.cardMessageId !== undefined && finalText !== '') {
      // 历史里记卡片消息自己的 message_id 和终稿，后续轮次才能引用它。
      recordMessage(handle.chatId, { id: handle.cardMessageId, at: Date.now(), from: 'bot', text: finalText })
    }
  }

  async function pushFinalCardText(handle, text) {
    // 终稿与流式文本只差首尾空白时不重复推送：非前缀替换会让整卡瞬间重渲染。
    if (text === handle.lastPushed || handle.lastPushed.trimEnd() === text) return
    handle.lastPushed = text
    const sequence = ++handle.sequence
    try {
      checkLark(await client.cardkit.v1.cardElement.content({
        path: { card_id: handle.cardId, element_id: CARD_ELEMENT_ID },
        data: { content: text, sequence },
      }))
      noteCardPrint(handle, text)
    } catch (error) {
      handle.degraded = true
      log.warn(`feishu-channel: final card update failed for ${handle.cardId}: ${String(error)}`)
    }
  }

  /** 按客户端打印速率估算这句文案还有多少字没打完。 */
  function noteCardPrint(handle, text) {
    advanceCardQueue(handle, Date.now())
    const chars = Array.from(text).length
    if (chars > handle.sentChars) handle.queueChars += chars - handle.sentChars
    handle.sentChars = chars
  }

  function advanceCardQueue(handle, now) {
    if (handle.queueChars > 0 && handle.queueAt > 0) {
      const drained = ((now - handle.queueAt) / 1000) * CARD_PRINT_RATE
      handle.queueChars = Math.max(0, handle.queueChars - drained)
    }
    handle.queueAt = now
  }

  /** 收尾前等客户端把已送达的文字打完，避免关闭流式时一次性倾倒。 */
  async function waitCardDrain(handle) {
    advanceCardQueue(handle, Date.now())
    if (handle.queueChars <= 0) return
    const ms = Math.min(5000, Math.ceil((handle.queueChars / CARD_PRINT_RATE) * 1000) + 250)
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function closeCardStreaming(handle) {
    // 不关流式的话，聊天预览会一直显示“生成中”，卡片也无法转发。
    const sequence = ++handle.sequence
    try {
      checkLark(await client.cardkit.v1.card.settings({
        path: { card_id: handle.cardId },
        data: { settings: JSON.stringify({ config: { streaming_mode: false } }), sequence },
      }))
    } catch (error) {
      log.warn(`feishu-channel: failed to close streaming card ${handle.cardId}: ${String(error)}`)
    }
  }

  function renderCardText(handle) {
    const entries = [...handle.texts.entries()].sort((a, b) => a[0] - b[0])
    return clipText(entries.map(([, value]) => value).join('\n'), CARD_TEXT_LIMIT)
  }

  /** 按码点截断，避免把 emoji 的代理对切成半个导致卡片更新失败。 */
  function clipText(text, limit) {
    const chars = Array.from(text)
    return chars.length <= limit ? text : chars.slice(0, limit).join('')
  }

  /** 卡片 JSON 2.0：流式模式 + 一个可流式更新的 markdown 元素。 */
  function cardJson() {
    return {
      schema: '2.0',
      config: {
        update_multi: true,
        streaming_mode: true,
        // 默认 fast 策略在新更新到达时，会把上一次还没打完的字立即全部上屏，
        // 观感就是“蹦一段、打几个字、再蹦一段”。delay 会先把旧内容按打字机
        // 打完再打新内容；400 字/秒足以跟上模型输出，队列不会积压。
        // 7.20–7.22 客户端不支持自定义这些参数。
        streaming_config: {
          print_frequency_ms: { default: CARD_PRINT_INTERVAL_MS },
          print_step: { default: CARD_PRINT_STEP },
          print_strategy: 'delay',
        },
      },
      body: {
        elements: [
          { tag: 'markdown', element_id: CARD_ELEMENT_ID, content: '' },
        ],
      },
    }
  }

  /** state 退役：清掉卡片定时器与句柄，避免残留更新写到已删除的卡片。 */
  function disposeCards(state) {
    for (const handle of state.cards.values()) {
      if (handle.timer !== undefined) clearTimeout(handle.timer)
      handle.timer = undefined
    }
    state.cards.clear()
  }

  return { onAssistantChunk, onAssistantEnd, disposeCards }
}
