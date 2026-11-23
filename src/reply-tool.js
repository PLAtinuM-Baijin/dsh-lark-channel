/**
 * 发送方式工具 feishu_reply_mode。
 *
 * 默认发送方式是直接发新消息；模型只在确实需要指明在回应哪一句时，
 * 在开始输出正文前调用它改成引用：
 *   - direct：显式改回直发（一般不必要）；
 *   - reply：引用一条消息回复（缺省引用本轮触发消息，也可以引用「最近聊天记录」里的某条）。
 *
 * 工具本身不发送任何东西，只把选择写进 channel 当前轮的发送状态；
 * 流式卡片仍照常工作。只有本地历史里存在的 message_id 才能作为引用目标。
 */
import Schema from '@deepseek-ai/schemastery'
import { getChannelRuntime } from './channel-runtime.js'

export const name = 'feishu-reply-tool'
export const inject = ['tools']

export const Config = Schema.object({})

const CHAT_SESSION = /^feishu-(oc_[A-Za-z0-9]+)-\d{8}$/

const PARAMETERS = {
  type: 'object',
  properties: {
    mode: {
      type: 'string',
      enum: ['direct', 'reply'],
      description: 'direct=直接在聊天里发新消息（不引用）；reply=引用一条消息回复。',
    },
    message_id: {
      type: 'string',
      description: 'mode=reply 时可选：要引用的消息 ID（从「最近聊天记录」里选）。缺省引用本轮触发消息。',
    },
  },
  required: ['mode'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    mode: { type: 'string' },
    replyTo: { type: 'string' },
  },
  required: ['ok', 'message', 'mode'],
  additionalProperties: false,
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'feishu_reply_mode',
    description:
      '选择这一轮回复的发送方式（不会立刻发消息）。默认直接发新消息；只有确实需要指明在回应哪一句时才用 reply 引用（缺省引用本轮触发消息，也可用 message_id 引用「最近聊天记录」里的某条）。在开始输出正文前调用。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderResult,
    },
    async execute(args, exec) {
      return execute(args, exec)
    },
  })
}

async function execute(args, exec) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('feishu_reply_mode: 参数必须是对象')
  }
  const mode = args.mode
  if (mode !== 'direct' && mode !== 'reply') throw new Error('feishu_reply_mode: mode 必须是 direct 或 reply')
  const messageId = typeof args.message_id === 'string' ? args.message_id.trim() : ''
  if (messageId !== '' && mode !== 'reply') throw new Error('feishu_reply_mode: message_id 只在 mode=reply 时使用')

  const sessionId = exec.agent?.session?.id
  if (typeof sessionId !== 'string' || CHAT_SESSION.exec(sessionId) === null) {
    throw new Error('feishu_reply_mode: 当前会话不是飞书聊天会话，不能选择发送方式')
  }
  const runtime = getChannelRuntime()
  if (runtime === undefined) throw new Error('feishu_reply_mode: feishu-channel 插件未加载，发送方式不可用')

  const result = await runtime.setDelivery({ sessionId, mode, messageId })
  if (result.replyTo !== undefined) {
    return {
      ok: true,
      mode,
      replyTo: result.replyTo,
      message: `这一轮改为引用回复消息 ${result.replyTo}。`,
    }
  }
  return { ok: true, mode, message: '这一轮改为直接发送新消息，不引用任何消息。' }
}

function renderResult(_args, value) {
  return [{ type: 'text', text: value.message }]
}
