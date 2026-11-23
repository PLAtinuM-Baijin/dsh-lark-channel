/**
 * 定时任务工具 feishu_schedule。
 *
 * 任务由 feishu-channel 常驻插件持有（默认存在 ~/.dsh-feishu-schedules.json），
 * 到点后唤醒目标聊天「当天」的 Session，模型这一轮的可见回复会作为新消息
 * 主动发到飞书。只有主人私聊的 feishu-power 会话可以创建/查看/取消。
 */
import Schema from '@deepseek-ai/schemastery'
import { getChannelRuntime } from './channel-runtime.js'

export const name = 'feishu-schedule-tool'
export const inject = ['tools']

export const Config = Schema.object({
  ownerChatId: Schema.string().description('owner 私聊的 chat_id；只有这个会话可以管理定时任务'),
  allowedChatIds: Schema.array(Schema.string()).default([]).description('允许作为定时目标的群聊 chat_id'),
})

const CHAT_SESSION = /^feishu-(oc_[A-Za-z0-9]+)-\d{8}$/

const PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['create', 'list', 'cancel'],
      description: 'create 创建任务；list 查看全部任务；cancel 按 task_id 取消。',
    },
    text: {
      type: 'string',
      description: 'create 必填：到点后交给模型的完整任务，如「提醒主人 19:30 去开团日活动，并确认他出发了」。',
    },
    after_seconds: {
      type: 'integer',
      description: '时间三选一：多少秒后触发（适合几分钟后的提醒）。',
    },
    at: {
      type: 'string',
      description: '时间三选一：绝对时间 "YYYY-MM-DD HH:MM"（按服务器配置时区，默认 Asia/Shanghai），也接受带时区的 ISO 8601。',
    },
    daily: {
      type: 'string',
      description: '时间三选一：每天重复的时刻 "HH:MM"（24 小时制）。',
    },
    chat_id: {
      type: 'string',
      description: '可选：定时消息发到哪个聊天；缺省是当前主人私聊，也可以是白名单群聊的 chat_id。',
    },
    task_id: {
      type: 'string',
      description: 'cancel 必填：要取消的任务 id（先用 action=list 查）。',
    },
  },
  required: ['action'],
  additionalProperties: false,
}

const TASK_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    chatId: { type: 'string' },
    prompt: { type: 'string' },
    repeatText: { type: 'string' },
    nextAtText: { type: 'string' },
  },
  required: ['id', 'chatId', 'prompt', 'repeatText', 'nextAtText'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    tasks: { type: 'array', items: TASK_SCHEMA },
  },
  required: ['ok', 'message'],
  additionalProperties: false,
}

export function apply(ctx, config) {
  const ownerChatId = (config.ownerChatId ?? process.env.FEISHU_OWNER_CHAT_ID ?? '').trim()
  const allowedChatIds = new Set(
    (config.allowedChatIds ?? (process.env.FEISHU_ALLOWED_CHAT_IDS ?? '').split(','))
      .map((id) => id.trim())
      .filter(Boolean),
  )

  ctx.tools.register({
    name: 'feishu_schedule',
    description:
      '管理定时任务。到点时会唤醒目标聊天当天的会话，你的回复作为新消息主动发到飞书。create 需要 text 加时间三选一（after_seconds / at / daily）；list 查看；cancel 按 task_id 取消。只有主人私聊可用。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderResult,
    },
    async execute(args, exec) {
      return execute(args, exec, { ownerChatId, allowedChatIds })
    },
  })
}

async function execute(args, exec, options) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('feishu_schedule: 参数必须是对象')
  }
  const ownerChatId = ownerChatOf(exec, options.ownerChatId)
  const runtime = getChannelRuntime()
  if (runtime === undefined) throw new Error('feishu_schedule: feishu-channel 插件未加载，无法管理定时任务')

  if (args.action === 'create') {
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    if (text === '') throw new Error('feishu_schedule: create 需要 text（到点交给模型的任务内容）')
    const timing = {}
    if (args.after_seconds !== undefined) timing.afterSeconds = args.after_seconds
    if (args.at !== undefined) timing.at = args.at
    if (args.daily !== undefined) timing.daily = args.daily
    const chatId = targetChat(args.chat_id, ownerChatId, options)
    const task = await runtime.createTask({ chatId, prompt: text, timing })
    return {
      ok: true,
      message: `已创建定时任务 ${task.id}：${task.repeatText}，${task.nextAtText} 触发。到点后回复会作为新消息发到 ${task.chatId}。`,
      tasks: [pickTask(task)],
    }
  }

  if (args.action === 'list') {
    const tasks = await runtime.listTasks()
    return {
      ok: true,
      message:
        tasks.length === 0
          ? '当前没有定时任务。'
          : `共 ${tasks.length} 个定时任务：\n${tasks.map(describeLine).join('\n')}`,
      tasks: tasks.map(pickTask),
    }
  }

  if (args.action === 'cancel') {
    const id = typeof args.task_id === 'string' ? args.task_id.trim() : ''
    if (id === '') throw new Error('feishu_schedule: cancel 需要 task_id')
    const task = await runtime.cancelTask(id)
    if (task === undefined) return { ok: false, message: `没有找到定时任务 ${id}。`, tasks: [] }
    return { ok: true, message: `已取消定时任务 ${id}。`, tasks: [pickTask(task)] }
  }

  throw new Error('feishu_schedule: action 只能是 create / list / cancel')
}

function ownerChatOf(exec, ownerChatId) {
  if (ownerChatId === '') throw new Error('feishu_schedule: 没有配置 FEISHU_OWNER_CHAT_ID，拒绝管理定时任务')
  const sessionId = exec.agent?.session?.id
  const match = typeof sessionId === 'string' ? CHAT_SESSION.exec(sessionId) : null
  if (match === null) throw new Error('feishu_schedule: 当前会话不是飞书聊天会话，不能管理定时任务')
  if (match[1] !== ownerChatId) throw new Error('feishu_schedule: 只有主人私聊可以管理定时任务')
  return match[1]
}

function targetChat(raw, ownerChatId, options) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return ownerChatId
  if (value === ownerChatId || options.allowedChatIds.has(value)) return value
  throw new Error(`feishu_schedule: chat_id ${value} 不是主人私聊或白名单群聊，拒绝`)
}

/** 输出 schema 是 additionalProperties:false；只回工具声明过的字段。 */
function pickTask(task) {
  return {
    id: task.id,
    chatId: task.chatId,
    prompt: task.prompt,
    repeatText: task.repeatText,
    nextAtText: task.nextAtText,
  }
}

function describeLine(task) {
  const excerpt = Array.from(task.prompt).length > 60 ? `${Array.from(task.prompt).slice(0, 60).join('')}…` : task.prompt
  return `- ${task.id} · ${task.repeatText} · ${task.nextAtText} · ${excerpt}`
}

function renderResult(_args, value) {
  return [{ type: 'text', text: value.message }]
}
