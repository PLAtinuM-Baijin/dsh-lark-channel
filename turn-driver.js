/**
 * 回合驱动：入站消息交给 agent（steer）、每个 chat 一个 driver 盯着轮次结束、
 * 超时取消与追加消息、assistant 文本转播。
 * 需要 Session/Agent 与发送能力的部分由 createTurnDriver 工厂注入；
 * 会话状态与队列仍由 index.js 持有。
 */
import { CANCEL_SETTLE_MS, DELIVERED_LIMIT, PENDING_LIMIT, TURN_TIMEOUT } from './constants.js'
import { errorText } from './lark-utils.js'

export function createTurnDriver({
  ctx,
  config,
  log,
  ensureAgent,
  retireNow,
  timeoutFor,
  touchDeadline,
  outboundTarget,
  sendText,
  sendChatText,
  sendTurnNotice,
  userMessage,
  assistantText,
  cardStream,
}) {
  /**
   * 把一条准备好的消息交给模型。空闲时 steer 会唤醒新一轮；运行中则进入
   * next-step（下个步骤可见），于是后到的消息成为本轮的追加消息而不是新的一轮。
   * proactive=true 表示定时任务触发：没有可引用的用户消息，回复改发新消息。
   */
  function handOff(state, messageId, content, proactive = false) {
    const agent = state.agent
    if (agent === undefined || state.cancelling) {
      state.queue.push({ messageId, content, proactive })
      void drive(state)
      return
    }

    const message = userMessage(content, proactive ? 'schedule' : 'user')
    const now = Date.now()
    const startingTurn = agent.status !== 'running' || state.turnStartedAt === 0
    if (startingTurn) state.turnStartedAt = now
    state.deadline = now + timeoutFor(state.chatId, state.chatType)
    // 新一轮开始：清掉上一轮模型选的发送方式，回到默认。
    if (startingTurn) state.delivery = undefined
    // 主动提示只在开启新一轮时切换成主动模式（新消息、不引用）；如果 agent 正在
    // 跑别的轮次，就并入当前轮，回复仍按当前轮的引用目标发。
    if (!proactive || startingTurn) {
      state.proactive = proactive
      state.replyTo = proactive ? undefined : messageId
    }
    state.pending.set(message.id, { messageId, content, proactive })
    if (state.pending.size > PENDING_LIMIT) state.pending.delete(state.pending.keys().next().value)

    try {
      agent.steer(message)
    } catch (error) {
      state.pending.delete(message.id)
      const label = messageId ?? 'a scheduled task'
      log.error(`feishu-channel: failed to hand ${label} to the agent: ${String(error)}`)
      console.error(`feishu-channel: failed to hand ${label} to the agent: ${String(error)}`)
      if (messageId !== undefined) {
        void sendText(messageId, '抱歉，把这条消息交给模型时出错了，请重新发送。', state.chatId).catch(() => undefined)
      }
      return
    }

    // 空闲时 steer 会同步把 phase 切到 running；steer 之后仍报 idle，说明撞上了
    // runMaintenance（维护期间 status 也报 idle），唤醒被 agent 记到维护结束再放。
    state.latched = agent.status !== 'running'

    void flush(agent)
    void drive(state)
  }

  /** 每个 state 一个 driver：保证 agent 就绪、清空入站队列、盯着轮次结束或超时。 */
  async function drive(state) {
    if (state.driving) return
    state.driving = true
    try {
      for (;;) {
        if (state.agent === undefined) {
          try {
            state.agent = await ensureAgent(state)
          } catch (error) {
            const reason = errorText(error)
            log.error(`feishu-channel: failed to prepare session ${state.sessionId}: ${reason}`)
            console.error(`feishu-channel: failed to prepare session ${state.sessionId}: ${reason}`)
            const unsent = state.queue.splice(0)
            for (const item of unsent) {
              if (item.messageId === undefined) continue
              await sendText(item.messageId, '抱歉，处理这条消息时出错了，请稍后再试。', state.chatId).catch(() => undefined)
            }
            return
          }
        }
        attachDeliverer(state)

        while (state.queue.length > 0) {
          const item = state.queue.shift()
          handOff(state, item.messageId, item.content, item.proactive ?? false)
        }

        const agent = state.agent
        // latched：消息已经 steer 进 inbox，但 agent 正停在 maintenance，status 报 idle。
        // 维护结束时 agent 自己会把这一轮开起来，所以这里照常等，不能当空闲收尾。
        if (agent.status !== 'running' && !state.latched) {
          state.turnStartedAt = 0
          state.deadline = 0
          state.pending.clear()
          state.replyTo = undefined
          state.proactive = false
          state.delivery = undefined
          return
        }

        if (state.deadline === 0) {
          state.turnStartedAt = Date.now()
          state.deadline = state.turnStartedAt + timeoutFor(state.chatId, state.chatType)
        }

        // 只扫自己这一轮：sweepFrom 只是“扫到哪”的游标，原先在挂监听时初始化一次后
        // 一直往后推。两轮之间若同一个 live agent 被别的终端驱动出了回合，那些
        // assistant/message 会落在下一轮的扫描范围里，被当成这轮的回复发出去。
        state.sweepFrom = agent.session.seq
        try {
          await waitIdleActivity(state)
        } catch (error) {
          state.latched = false
          if (error !== TURN_TIMEOUT) throw error
          await abortTurn(state)
          continue
        }
        state.latched = false

        await flush(agent)
        sweep(state)
        await state.outbound
      }
    } catch (error) {
      log.error(`feishu-channel: driver failed for ${state.sessionId}: ${String(error)}`)
      console.error(`feishu-channel: driver failed for ${state.sessionId}: ${String(error)}`)
      if (outboundTarget(state) !== undefined) {
        await sendTurnNotice(state, '抱歉，这一轮处理出错了，请稍后再试。').catch(() => undefined)
      }
    } finally {
      state.driving = false
      if (state.retired) retireNow(state)
    }
  }

  /** 常驻监听：chunk 帧驱动流式卡片，end 帧决定这条消息怎么发。 */
  function attachDeliverer(state) {
    const agent = state.agent
    if (agent === undefined) return
    if (state.attachedAgent === agent && state.unsubscribe !== undefined) return
    state.unsubscribe?.()
    state.attachedAgent = agent
    state.sweepFrom = agent.session.seq
    state.unsubscribe = ctx.on('agent/assistant-stream', (payload) => {
      if (payload?.agent !== agent) return
      const frame = payload?.frame
      if (frame === undefined) return
      if (frame.type === 'chunk') {
        cardStream.onAssistantChunk(state, frame)
        return
      }
      if (frame.type === 'end') cardStream.onAssistantEnd(state, frame)
    })
  }

  function deliver(state, seq) {
    const agent = state.agent
    // 只转播由本插件驱动的轮次；同会话在别的终端里跑的内容不往飞书里塞。
    if (agent === undefined || !state.driving) return
    if (state.delivered.has(seq)) return
    const [event] = agent.session.snapshotEvents(seq, seq + 1)
    if (event === undefined || event.type !== 'assistant/message') return
    const text = assistantText(event)
    if (text === '') return

    state.delivered.add(seq)
    if (state.delivered.size > DELIVERED_LIMIT) state.delivered.delete(state.delivered.keys().next().value)
    touchDeadline(state)

    const target = outboundTarget(state)
    const chatId = state.chatId
    if (target === undefined) return
    state.outbound = state.outbound.then(async () => {
      try {
        if (target.replyTo !== undefined) await sendText(target.replyTo, text, chatId)
        else await sendChatText(chatId, text)
      } catch (error) {
        // 单条过程消息失败不阻断后续消息和最终答案。
        log.warn(`feishu-channel: failed to send seq ${seq} of ${state.sessionId}: ${String(error)}`)
        console.warn(`feishu-channel: failed to send seq ${seq} of ${state.sessionId}: ${String(error)}`)
      }
    })
  }

  /** 收尾扫描：实时监听和收尾可能看到同一条，delivered 去重。 */
  function sweep(state) {
    const agent = state.agent
    if (agent === undefined) return
    for (const event of agent.session.snapshotEvents(state.sweepFrom)) {
      if (event.type !== 'assistant/message') continue
      deliver(state, event.seq)
    }
    state.sweepFrom = agent.session.seq
  }

  /** 等到 agent 空闲；有新产出或新消息就重新计时，绝对上限是 maxTurnMs。 */
  async function waitIdleActivity(state) {
    const agent = state.agent
    const cap = state.turnStartedAt + config.maxTurnMs.get()
    for (;;) {
      const boundary = Math.min(state.deadline, cap)
      const remaining = boundary - Date.now()
      if (remaining <= 0) throw TURN_TIMEOUT
      try {
        await waitIdle(agent, remaining)
        return
      } catch (error) {
        if (error !== TURN_TIMEOUT) throw error
        // 等待期间产生过新产出/新消息（deadline 被推后）就继续等；否则真的超时。
        if (Date.now() < Math.min(state.deadline, cap)) continue
        throw TURN_TIMEOUT
      }
    }
  }

  /** 轮次超时：取消当前轮；没被模型领取的消息由 discarded 事件放回队列，自动重开一轮。 */
  async function abortTurn(state) {
    const agent = state.agent
    log.warn(`feishu-channel: ${state.sessionId} timed out; cancelling the running turn`)
    console.warn(`feishu-channel: ${state.sessionId} timed out; cancelling the running turn`)
    state.cancelling = true
    try {
      try {
        // 默认会清空 inbox；未领取的用户消息由 agent/inbox/discarded 收回并重排。
        agent.cancel({ kind: 'user' })
      } catch (error) {
        log.warn(`feishu-channel: cancel after timeout failed: ${String(error)}`)
      }
      // 取消时可能还落盘一段被中断的部分文本；短暂等待后再收尾发送。
      await waitIdle(agent, CANCEL_SETTLE_MS).catch(() => undefined)
      await flush(agent)
      sweep(state)
      await state.outbound
      if (outboundTarget(state) !== undefined) {
        await sendTurnNotice(state, '这一轮处理超时了，已中止；还没处理的消息会自动重新开始，也可以直接重发。').catch((sendError) => {
          log.warn(`feishu-channel: failed to send timeout notice: ${String(sendError)}`)
        })
      }
    } finally {
      state.cancelling = false
    }
  }

  /** 等这一轮跑完。whenIdle() 会跟着 activity 链走，所以“正在跑 + 队列里还有”也会一起等。 */
  function waitIdle(agent, timeoutMs = config.replyTimeoutMs.get()) {
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(TURN_TIMEOUT), timeoutMs)
    })
    return Promise.race([agent.whenIdle(), timeout]).finally(() => clearTimeout(timer))
  }

  async function flush(agent) {
    try {
      await ctx.sessions.flush(agent.session)
    } catch (error) {
      // 持久化失败不应该阻断回复；下一次检查点还会再写。
      log.warn(`feishu-channel: flush failed for ${agent.session.id}: ${String(error)}`)
    }
  }

  return { handOff, deliver, flush, drive }
}
