/**
 * 飞书长期记忆工具 feishu_memory。
 *
 * 直接注册一个普通工具定义对象（name/description/parameters/output/execute），
 * 结构与 @deepseek-ai/dsh-tools 的 defineTool 输出一致；这样 bundle 不必再依赖
 * 整个 dsh-tools 包及其 peer 依赖图。
 *
 * 作用域守卫是硬约束，不依赖提示词：
 *   - 普通聊天会话：只能读写自己的 chat 记忆，section 只能是 facts；
 *   - owner 私聊（FEISHU_OWNER_CHAT_ID）：额外可以写全局记忆；
 *   - 顶层整理会话（默认 feishu-root）：可以操作任意合法 chatId 和全局记忆。
 */
import Schema from '@deepseek-ai/schemastery'
import {
  RENDER_LIMITS,
  forget,
  isValidChatId,
  isValidSection,
  listChat,
  listGlobal,
  remember,
  renderChat,
  renderGlobal,
  setMemoryDir,
} from './memory-store.js'

export const name = 'feishu-memory-tool'
export const inject = ['tools']

export const Config = Schema.object({
  memoryDir: Schema.string().description('记忆目录；缺省用 FEISHU_MEMORY_DIR 或 ~/.dsh-feishu-memory'),
  ownerChatId: Schema.string().description('owner 私聊的 chat_id；只有这个会话可以写全局记忆'),
  curatorSessionId: Schema.string().default('feishu-root').description('顶层整理会话的 id'),
})

const CHAT_SESSION = /^feishu-(oc_[A-Za-z0-9]+)-\d{8}$/

const PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['remember', 'forget', 'list'],
      description: 'remember=写入一条长期事实；forget=删除匹配的条目；list=查看已有记忆。',
    },
    scope: {
      type: 'string',
      enum: ['chat', 'global'],
      description: 'chat=当前会话/指定会话的隔离记忆；global=所有会话共享的记忆。缺省 chat。',
    },
    section: {
      type: 'string',
      enum: ['facts', 'user', 'persona'],
      description: 'facts=一般事实；user=用户画像；persona=机器人人格。chat 只支持 facts。缺省 facts。',
    },
    text: {
      type: 'string',
      description: 'remember 要写入的内容；forget 用来匹配子串。单行，尽量简短。',
    },
    chatId: {
      type: 'string',
      description: '仅整理会话可用：指定要读写的 chat 记忆（oc_ 开头）。普通会话不能指定别人的 chatId。',
    },
  },
  required: ['action'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    scope: { type: 'string' },
    chatId: { type: 'string' },
    removed: { type: 'integer' },
    entries: { type: 'array', items: { type: 'string' } },
    totalChars: { type: 'integer' },
    limit: { type: 'integer' },
    trimmed: { type: 'boolean' },
  },
  required: ['ok', 'message'],
  additionalProperties: false,
}

export function apply(ctx, config) {
  setMemoryDir(config.memoryDir)
  const ownerChatId = (config.ownerChatId ?? process.env.FEISHU_OWNER_CHAT_ID ?? '').trim()
  const curatorSessionId = config.curatorSessionId

  ctx.tools.register({
    name: 'feishu_memory',
    description:
      '管理飞书机器人的长期记忆。用户明确要求记住、透露稳定画像或长期约定时使用；不要记录临时信息和聊天流水。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: renderResult,
    },
    async execute(args, exec) {
      return execute(args, exec, { ownerChatId, curatorSessionId })
    },
  })
}

async function execute(args, exec, options) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('feishu_memory: 参数必须是对象')
  const action = args.action
  if (action !== 'remember' && action !== 'forget' && action !== 'list') {
    throw new Error('feishu_memory: action 必须是 remember / forget / list')
  }
  const scope = args.scope ?? 'chat'
  if (scope !== 'chat' && scope !== 'global') throw new Error('feishu_memory: scope 必须是 chat 或 global')
  const sectionExplicit = args.section !== undefined
  const section = args.section ?? 'facts'
  if (!isValidSection(section)) throw new Error('feishu_memory: section 必须是 facts / user / persona')

  const agent = exec.agent
  if (agent === undefined) throw new Error('feishu_memory: 没有调用方会话，记忆功能不可用')
  const caller = resolveCaller(agent.session.id, options.curatorSessionId)

  if (action === 'list') {
    return listAction({ scope, section, sectionExplicit, chatId: args.chatId, caller })
  }

  if (typeof args.text !== 'string' || args.text.trim() === '') {
    throw new Error('feishu_memory: remember/forget 需要非空的 text')
  }

  if (scope === 'global') {
    assertGlobalWrite(caller, options.ownerChatId)
    const result =
      action === 'remember'
        ? await remember({ scope: 'global', section, text: args.text })
        : await forget({ scope: 'global', section, text: args.text })
    return finishWrite(action, scope, undefined, section, result)
  }

  const targetChatId = chatTarget(caller, args.chatId)
  if (section !== 'facts') throw new Error('feishu_memory: chat 记忆只支持 facts')
  const result =
    action === 'remember'
      ? await remember({ scope: 'chat', chatId: targetChatId, section: 'facts', text: args.text })
      : await forget({ scope: 'chat', chatId: targetChatId, section: 'facts', text: args.text })
  return finishWrite(action, scope, targetChatId, section, result)
}

function finishWrite(action, scope, chatId, section, result) {
  const value = {
    ok: true,
    scope,
    message:
      action === 'remember'
        ? result.duplicate
          ? '这条记忆已存在，未重复写入'
          : '已记住'
        : result.removed > 0
          ? `已删除 ${result.removed} 条记忆`
          : '没有找到匹配的记忆',
    totalChars: scope === 'global' ? renderGlobal().length : renderChat(chatId).length,
    limit: scope === 'global' ? RENDER_LIMITS.global : RENDER_LIMITS.chat,
    trimmed: result.trimmed,
  }
  if (chatId !== undefined) value.chatId = chatId
  if (action === 'forget') value.removed = result.removed
  return value
}

function listAction({ scope, section, sectionExplicit, chatId, caller }) {
  if (scope === 'global') {
    if (caller.kind === 'unknown') throw new Error('feishu_memory: 无法识别当前会话，记忆功能不可用')
    const entries = listGlobal(sectionExplicit ? section : undefined)
    return listResult('global', undefined, entries, renderGlobal().length, RENDER_LIMITS.global)
  }

  const targetChatId = chatTarget(caller, chatId)
  if (section !== 'facts') throw new Error('feishu_memory: chat 记忆只支持 facts')
  const entries = listChat(targetChatId, 'facts')
  return listResult('chat', targetChatId, entries, renderChat(targetChatId).length, RENDER_LIMITS.chat)
}

function listResult(scope, chatId, entries, totalChars, limit) {
  const value = {
    ok: true,
    scope,
    message: `共 ${entries.length} 条记忆`,
    entries: entries.map((entry) => `[${entry.section}] [${entry.date}] ${entry.text}`),
    totalChars,
    limit,
  }
  if (chatId !== undefined) value.chatId = chatId
  return value
}

function resolveCaller(sessionId, curatorSessionId) {
  if (typeof sessionId !== 'string') return { kind: 'unknown' }
  if (sessionId === curatorSessionId) return { kind: 'curator' }
  const match = CHAT_SESSION.exec(sessionId)
  if (match !== null) return { kind: 'chat', chatId: match[1] }
  return { kind: 'unknown' }
}

function chatTarget(caller, requestedChatId) {
  const requested = typeof requestedChatId === 'string' ? requestedChatId.trim() : ''
  if (caller.kind === 'curator') {
    if (!isValidChatId(requested)) throw new Error('feishu_memory: 整理会话操作 chat 记忆时必须提供合法的 chatId')
    return requested
  }
  if (caller.kind === 'chat') {
    if (requested !== '' && requested !== caller.chatId) {
      throw new Error('feishu_memory: 当前会话只能操作自己的 chat 记忆')
    }
    return caller.chatId
  }
  throw new Error('feishu_memory: 无法识别当前会话，记忆功能不可用')
}

function assertGlobalWrite(caller, ownerChatId) {
  if (caller.kind === 'curator') return
  if (caller.kind === 'chat' && ownerChatId !== '' && caller.chatId === ownerChatId) return
  throw new Error('feishu_memory: 只有 owner 私聊或记忆整理会话可以写全局记忆')
}

function renderResult(_args, value) {
  const lines = [value.message]
  for (const entry of value.entries ?? []) lines.push(`- ${entry}`)
  return [{ type: 'text', text: lines.join('\n') }]
}
