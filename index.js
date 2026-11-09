/**
 * feishu-channel —— dsh 的飞书（Lark）常驻 channel 插件。
 *
 * 形态：一个普通 Cordis Host 插件（`apply(ctx, config)`），随 profile 常驻；
 *      内部跑 `@larksuiteoapi/node-sdk` 的 WSClient 长连接，收 im.message.receive_v1。
 * 路由：一个飞书 chat_id 对应一个 dsh Session（session id = 前缀 + chat_id + 当天日期）。
 * 触发：把消息作为 user message 放进该 Session 的 inbox（agent.followup），
 *      由 dsh 自己的 agent loop 跑一轮；每提交一条带文本的 assistant/message
 *      就单独回一条飞书消息，最后一条即总结（不编辑、不流式）。
 * 媒体：下载到的附件一律归档到 ~/feishu-history/files（不自动清理）。
 *      owner 会话给绝对路径，由 power preset 自己用命令处理；群聊没有工具，
 *      维持图片 image block / 文本内联 / 其余一句说明。
 *
 * 依赖的 Host 服务：
 *   - ctx.sessionController  `@deepseek-ai/dsh-api-session-controller`（create / resolveAgent）
 *   - ctx.agents             `@deepseek-ai/dsh-agent`（live agent 注册表）
 *   - ctx.sessions           `@deepseek-ai/dsh-session`（flush 持久化）
 *   - ctx.attachments        `@deepseek-ai/dsh-attachment`（图片入 durable 存储）
 * 用到的 Agent 接口（`@deepseek-ai/dsh-agent-loop` 实现）：
 *   agent.session / agent.status / agent.followup(msg) / agent.whenIdle() / agent.cancel(cause)
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as Lark from '@larksuiteoapi/node-sdk'
import Schema from '@deepseek-ai/schemastery'

export const name = 'feishu-channel'
/** 等服务可用后才激活；缺任何一个，本插件不会启动。 */
export const inject = ['sessionController', 'agents', 'sessions', 'attachments']

export const Config = Schema.object({
  appId: Schema.string().required().description('飞书自建应用 App ID'),
  appSecret: Schema.string().required().description('飞书自建应用 App Secret（建议用 !!js process.env.* 注入）'),
  cwd: Schema.string().description('每个 Session 的工作目录；缺省用 Host 的默认目录'),
  agentPreset: Schema.string().default('feishu').description('普通 chat（群聊、非 owner 私聊）创建 Session 时使用的 agent preset'),
  ownerChatId: Schema.string().default('').description('主人私聊的 chat_id；该 chat 使用 ownerPreset'),
  ownerPreset: Schema.string().default('feishu-power').description('主人私聊使用的 agent preset'),
  replyTimeoutMs: Schema.number().default(180000).description('单条消息等待一轮生成的上限'),
  ownerReplyTimeoutMs: Schema.number().default(900000).description('主人私聊等待一轮生成的上限；power 任务经常超过 3 分钟'),
  requireMentionInGroup: Schema.boolean().default(true).description('群聊里只有 @机器人 才回应'),
  allowedChatIds: Schema.array(Schema.string()).default([]).description('允许的群聊 chat_id；空数组表示不接收任何群聊'),
  allowedOpenIds: Schema.array(Schema.string()).default([]).description('允许私聊的用户 open_id；空数组表示不接收任何私聊'),
  sessionPrefix: Schema.string().default('feishu-').description('Session id 前缀'),
  timeZone: Schema.string().default('Asia/Shanghai').description('会话按哪个时区切日'),
  logLevel: Schema.string().default('info').description('Lark SDK 日志级别：fatal/error/warn/info/debug/trace'),
})

/** 单条飞书富文本（post）消息的拆块阈值；post 官方上限 30KB，3500 字符留足余量。 */
const REPLY_CHUNK = 3500
/** 去重表最多记多少条 message_id；WS 重连时飞书可能重投最近的事件。 */
const SEEN_LIMIT = 1000
/** waitIdle 超时的内部标记。 */
const TURN_TIMEOUT = Symbol('feishu-channel/turn-timeout')
/** 超时取消后，等取消动作落盘（可能带一小段部分文本）的上限。 */
const CANCEL_SETTLE_MS = 5000
/** 下载到的所有附件统一归档到这里；不自动清理，磁盘由使用者负责。 */
const HISTORY_DIR = join(homedir(), 'feishu-history', 'files')
/** 普通文件、语音、视频的下载上限；流式写盘，不占进程内存。 */
const FILE_DOWNLOAD_LIMIT = 50 * 1024 * 1024
/** 图片上限仍按 attachment 的单图限制，超过就无法作为 image block 交给模型。 */
const IMAGE_DOWNLOAD_LIMIT = 20 * 1024 * 1024
/** 文本文件最多内联多少字节；更长的只取开头。 */
const TEXT_FILE_LIMIT = 64 * 1024
/** 只处理这些消息类型；卡片、系统消息等直接忽略。 */
const HANDLED_MESSAGE_TYPES = new Set(['text', 'post', 'image', 'file', 'audio', 'media', 'merge_forward'])
/** 能直接作为 image block 交给模型的格式（与 attachment-local 的 imageLimits 一致）。 */
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const IMAGE_FILE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])
/** image 媒体类型 → 归档后缀（用于没有原始文件名的图片）。 */
const IMAGE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
/** 按扩展名判断为可内联文本的文件类型。 */
const TEXT_FILE_TYPES = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.csv', '.tsv', '.log', '.tex', '.properties', '.gradle', '.ipynb',
  '.xml', '.html', '.htm', '.css', '.scss', '.less', '.svg',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.go', '.rs', '.rb', '.php',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.sql', '.lua', '.pl', '.swift', '.dart', '.r', '.m',
])

export function apply(ctx, config) {
  const log = ctx.logger
  /** chatId -> Promise：同一个 chat 的入站消息串行处理，保证回复与消息一一对应。 */
  const queues = new Map()
  /** messageId -> 首次见到的时间：WS 重连可能重投事件，按 message_id 去重。 */
  const seen = new Map()
  /** chatId -> { date, sessionId }：记住 create() 实际返回的 session id，避免反复建会话。 */
  const sessionIds = new Map()
  /** 白名单归一化：环境变量用逗号分隔，允许带空格。 */
  const allowedChatIds = new Set(config.allowedChatIds.map((id) => id.trim()).filter(Boolean))
  const allowedOpenIds = new Set(config.allowedOpenIds.map((id) => id.trim()).filter(Boolean))
  const discoveryMode = allowedChatIds.size === 0 && allowedOpenIds.size === 0
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const client = new Lark.Client({ appId: config.appId, appSecret: config.appSecret })
  const dispatcher = new Lark.EventDispatcher({}).register({
    // 回调要尽快返回，真正的处理放进队列。
    'im.message.receive_v1': (event) => {
      void onEvent(event)
    },
  })
  const ws = new Lark.WSClient({
    appId: config.appId,
    appSecret: config.appSecret,
    // Lark SDK 的日志级别是数字枚举；传字符串会让它的 `level >= info` 判断全部为假。
    loggerLevel: Lark.LoggerLevel[config.logLevel] ?? Lark.LoggerLevel.info,
  })

  // --- 连接 -------------------------------------------------------------
  // WSClient 自己维护心跳与重连；插件只负责“连上/失败”的日志与“卸载时断开”。
  try {
    const started = ws.start({ eventDispatcher: dispatcher })
    if (started && typeof started.catch === 'function') {
      started.catch((error) => {
        log.error(`feishu-channel: ws start failed: ${String(error)}`)
        console.error(`feishu-channel: ws start failed: ${String(error)}`)
      })
    }
    log.info('feishu-channel: long connection starting')
  } catch (error) {
    log.error(`feishu-channel: ws start threw: ${String(error)}`)
    console.error(`feishu-channel: ws start threw: ${String(error)}`)
  }

  ctx.effect(
    () => () => {
      try {
        ws.close()
      } catch (error) {
        log.warn(`feishu-channel: ws close failed: ${String(error)}`)
      }
    },
    'feishu-channel.ws',
  )

  // --- 入站事件 ---------------------------------------------------------
  async function onEvent(event) {
    const message = event?.message
    if (!message || !HANDLED_MESSAGE_TYPES.has(message.message_type)) return
    if (event.sender?.sender_type === 'app') return // 忽略机器人自己发的消息
    if (message.chat_type === 'group' && config.requireMentionInGroup && !message.mentions?.length) return

    const senderOpenId = event.sender?.sender_id?.open_id
    if (!isAllowed(message, senderOpenId)) {
      // 只记录 id、不记录正文；首次接入时靠这行拿到 chat_id / open_id 填白名单。
      // 两个白名单都为空时是“发现模式”：用 warn 保证在 dsh 默认日志级别下可见。
      const line = `feishu-channel: ignored message chat=${message.chat_id} chat_type=${message.chat_type} sender=${senderOpenId ?? 'unknown'} (not allowlisted)`
      if (discoveryMode) console.warn(line)
      else log.info(line)
      return
    }

    if (isDuplicate(message.message_id)) return

    const inbound = parseInbound(message)
    if (inbound === null) return

    enqueue(message.chat_id, () => turn(message.chat_id, message.chat_type, message.message_id, inbound))
  }

  /** 事件阶段只解析结构；真正的资源下载等排到这个 chat 的队列里再做。 */
  function parseInbound(message) {
    switch (message.message_type) {
      case 'text': {
        const text = parseText(message.content, message.mentions)
        return text === '' ? null : { kind: 'text', text }
      }
      case 'post': {
        // 富文本可以把 @ 和图片放在同一条消息里，是群聊里唯一能带图触达的形态。
        const { text, imageKeys } = parsePost(message.content, message.mentions)
        return text === '' && imageKeys.length === 0 ? null : { kind: 'post', text, imageKeys }
      }
      case 'image': {
        const imageKey = parseJson(message.content)?.image_key
        return typeof imageKey === 'string' ? { kind: 'image', fileKey: imageKey } : null
      }
      case 'file': {
        const content = parseJson(message.content)
        if (typeof content?.file_key !== 'string') return null
        return { kind: 'file', fileKey: content.file_key, fileName: content.file_name }
      }
      case 'audio': {
        const content = parseJson(message.content)
        const duration = Number(content?.duration)
        const seconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration / 1000) : undefined
        const notice = `用户发来一条语音${seconds === undefined ? '' : `（约 ${seconds} 秒）`}。我现在还不能收听或转写语音，请直接告诉用户。`
        if (typeof content?.file_key !== 'string') return { kind: 'other', text: notice }
        return {
          kind: 'audio',
          fileKey: content.file_key,
          fileName: typeof content.file_name === 'string' && content.file_name !== '' ? content.file_name : undefined,
          durationSeconds: seconds,
          notice,
        }
      }
      case 'media': {
        const content = parseJson(message.content)
        const name = typeof content?.file_name === 'string' && content.file_name !== '' ? content.file_name : undefined
        const shownName = name === undefined ? '' : safeFileName(name)
        const notice = `用户发来一个视频${shownName === '' ? '' : `「${shownName}」`}。我现在还不能处理视频，请直接告诉用户。`
        if (typeof content?.file_key !== 'string') return { kind: 'other', text: notice }
        const duration = Number(content.duration)
        return {
          kind: 'media',
          fileKey: content.file_key,
          fileName: name,
          durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.round(duration / 1000) : undefined,
          notice,
        }
      }
      case 'merge_forward':
        return { kind: 'other', text: '用户转发了一组聊天记录。我现在还读不了合并转发，请直接告诉用户。' }
      default:
        return null
    }
  }

  function isAllowed(message, senderOpenId) {
    if (message.chat_type === 'p2p') {
      return senderOpenId !== undefined && allowedOpenIds.has(senderOpenId)
    }
    return allowedChatIds.has(message.chat_id)
  }

  function isDuplicate(messageId) {
    if (messageId === undefined) return false
    if (seen.has(messageId)) return true
    seen.set(messageId, Date.now())
    if (seen.size > SEEN_LIMIT) {
      const oldest = seen.keys().next().value
      seen.delete(oldest)
    }
    return false
  }

  /** 每个 chat 一条串行链；跨 chat 天然并行（各 Session 各有一个 driver）。 */
  function enqueue(chatId, task) {
    const previous = queues.get(chatId) ?? Promise.resolve()
    const next = previous.then(task, task)
    queues.set(
      chatId,
      next.catch(() => undefined),
    )
    return next
  }

  // --- 一轮对话 ---------------------------------------------------------
  async function turn(chatId, chatType, messageId, inbound) {
    const sessionId = sessionIdFor(chatId)
    let unsubscribe
    try {
      // 下载、归档、图片入库都在这里做完；失败降级成文字说明，不让整轮报错。
      const prepared = await prepareInbound(messageId, inbound, isOwnerChat(chatId, chatType))
      const agent = await ensureAgent(chatId, chatType)

      // 记下当前日志位置：只从这之后取本轮的回答，避免把历史回答再发一遍。
      const from = agent.session.seq
      /** 已安排发送的事件 seq；实时监听和收尾扫描可能看到同一条。 */
      const delivered = new Set()
      /** 出站消息串成一条链，保证飞书里的先后顺序。 */
      let outbound = Promise.resolve()

      const deliver = (seq, reply) => {
        if (!reply || delivered.has(seq)) return
        delivered.add(seq)
        outbound = outbound.then(async () => {
          try {
            await sendText(messageId, reply)
          } catch (error) {
            // 单条过程消息失败不阻断后续消息和最终答案。
            log.warn(`feishu-channel: failed to send seq ${seq} of ${sessionId}: ${String(error)}`)
            console.warn(`feishu-channel: failed to send seq ${seq} of ${sessionId}: ${String(error)}`)
          }
        })
      }

      const sweep = () => {
        for (const event of agent.session.snapshotEvents(from)) {
          if (event.type !== 'assistant/message') continue
          deliver(event.seq, assistantText(event))
        }
      }

      // 模型每一步结束都会提交一条 assistant/message；提交后立刻单独发一条，
      // 最后一条天然就是总结。只有工具调用的步骤没有文本，不发。
      unsubscribe = ctx.on('agent/assistant-stream', (payload) => {
        if (payload.agent !== agent) return
        const frame = payload.frame
        if (frame?.type !== 'end' || frame.outcome?.kind !== 'committed') return
        if (frame.outcome.eventType !== 'assistant/message') return
        const [event] = agent.session.snapshotEvents(frame.outcome.seq, frame.outcome.seq + 1)
        if (event !== undefined) deliver(event.seq, assistantText(event))
      })

      agent.followup(userMessage(await userContent(prepared)))
      await flush(agent)

      try {
        await waitIdle(agent, timeoutFor(chatId, chatType))
      } catch (error) {
        if (error !== TURN_TIMEOUT) throw error
        // 超时后不取消的话，这一轮的答案会在下一轮里才出现，且白烧 token。
        log.warn(`feishu-channel: ${sessionId} timed out; cancelling the running turn`)
        console.warn(`feishu-channel: ${sessionId} timed out; cancelling the running turn`)
        try {
          agent.cancel({ kind: 'user' })
        } catch (cancelError) {
          log.warn(`feishu-channel: cancel after timeout failed: ${String(cancelError)}`)
        }
        // 取消时可能还落盘一段被中断的部分文本；短暂等待后再收尾发送。
        await waitIdle(agent, CANCEL_SETTLE_MS).catch(() => undefined)
        await flush(agent)
        sweep()
        await outbound
        await sendText(messageId, '这一轮处理超时了，已中止。请稍后重发。').catch((sendError) => {
          log.warn(`feishu-channel: failed to send timeout notice: ${String(sendError)}`)
        })
        return
      }

      await flush(agent)
      sweep()
      await outbound

      if (delivered.size === 0) log.warn(`feishu-channel: session ${sessionId} finished a turn without assistant text`)
    } catch (error) {
      log.error(`feishu-channel: turn failed for ${sessionId}: ${String(error)}`)
      console.error(`feishu-channel: turn failed for ${sessionId}: ${String(error)}`)
      await sendText(messageId, '抱歉，处理这条消息时出错了，请稍后再试。').catch((sendError) => {
        log.warn(`feishu-channel: failed to send error reply: ${String(sendError)}`)
      })
    } finally {
      unsubscribe?.()
    }
  }

  // --- 入站媒体 ---------------------------------------------------------
  /** 把一条入站消息变成「给模型的文字 + 待入库的图片」；下载/归档/格式问题只降级不抛错。 */
  async function prepareInbound(messageId, inbound, owner) {
    if (inbound.kind === 'text' || inbound.kind === 'other') return { text: inbound.text, images: [] }

    try {
      if (inbound.kind === 'post') {
        const images = []
        for (const [index, imageKey] of inbound.imageKeys.entries()) {
          try {
            const { buffer, contentType } = await downloadToBuffer(messageId, imageKey, 'image', IMAGE_DOWNLOAD_LIMIT)
            const mediaType = imageMediaType(contentType, buffer)
            await archiveBuffer(buffer, historyName(messageId, index, '', mediaType ?? contentType))
            if (mediaType !== undefined) images.push({ data: buffer, mediaType })
          } catch (error) {
            // 一张图失败不影响其余图片和正文。
            log.warn(`feishu-channel: failed to fetch post image ${imageKey}: ${String(error)}`)
          }
        }
        const text = inbound.text === '' ? '用户发来的富文本里有图片，请查看。' : inbound.text
        return { text, images }
      }

      if (inbound.kind === 'image') {
        const { buffer, contentType } = await downloadToBuffer(messageId, inbound.fileKey, 'image', IMAGE_DOWNLOAD_LIMIT)
        const mediaType = imageMediaType(contentType, buffer)
        await archiveBuffer(buffer, historyName(messageId, 0, '', mediaType ?? contentType))
        if (mediaType === undefined) return { text: '用户发来一张图片，但我没能识别出它的格式。', images: [] }
        return { text: '用户发来一张图片，请查看。', images: [{ data: buffer, mediaType }] }
      }

      if (inbound.kind === 'audio' || inbound.kind === 'media') {
        // 群聊没有工具，路径没有意义，维持原来的说明；只有 owner 私聊才下载。
        if (!owner) return { text: inbound.notice, images: [] }
        const fallback = inbound.kind === 'audio' ? 'voice' : 'video'
        const saved = await downloadToFile(
          messageId,
          inbound.fileKey,
          'file',
          FILE_DOWNLOAD_LIMIT,
          historyName(messageId, 0, inbound.fileName ?? fallback),
        )
        const label = inbound.kind === 'audio' ? '语音' : '视频'
        const seconds = inbound.durationSeconds === undefined ? '' : `（约 ${inbound.durationSeconds} 秒）`
        return {
          text: `主人发来一条${label}${seconds}，已保存到 ${saved.path}（${saved.size} 字节${mimeSuffix(saved.contentType)}）。可以用 shell 工具处理它（如 ffmpeg/ffprobe），没有相应工具就如实说明。`,
          images: [],
        }
      }

      // kind === 'file'
      const name = safeFileName(inbound.fileName) || 'file'
      const saved = await downloadToFile(
        messageId,
        inbound.fileKey,
        'file',
        FILE_DOWNLOAD_LIMIT,
        historyName(messageId, 0, name),
      )
      const looksImage = saved.contentType.startsWith('image/') || IMAGE_FILE_TYPES.has(extensionOf(name))
      if (looksImage && saved.size <= IMAGE_DOWNLOAD_LIMIT) {
        const buffer = await fs.readFile(saved.path)
        const mediaType = imageMediaType(saved.contentType, buffer, name)
        if (mediaType !== undefined) {
          return { text: `用户发来图片文件「${name}」，请查看。`, images: [{ data: buffer, mediaType, name }] }
        }
      }
      if (owner) {
        return {
          text: `主人发来文件「${name}」（${saved.size} 字节${mimeSuffix(saved.contentType)}），已保存到 ${saved.path}。你可以用 shell 或文件工具查看、处理它。`,
          images: [],
        }
      }
      if (isTextFile(name, saved.contentType)) {
        const shown = (await readTextPrefix(saved.path, TEXT_FILE_LIMIT)).toString('utf8')
        const truncated = saved.size > TEXT_FILE_LIMIT ? '\n\n（文件较长，这里只有开头部分。）' : ''
        return { text: `用户发来文件「${name}」，内容如下：\n\n${shown}${truncated}`, images: [] }
      }
      return {
        text: `用户发来文件「${name}」（${saved.size} 字节）。这个格式我现在读不了，请直接告诉用户，不要猜测内容。`,
        images: [],
      }
    } catch (error) {
      log.warn(`feishu-channel: failed to fetch resource for ${messageId}: ${String(error)}`)
      console.warn(`feishu-channel: failed to fetch resource for ${messageId}: ${String(error)}`)
      const failure =
        inbound.kind === 'image' ? '用户发来一张图片，但下载失败了。'
          : inbound.kind === 'audio' ? '用户发来一条语音，但下载失败了。'
            : inbound.kind === 'media' ? '用户发来一个视频，但下载失败了。'
              : '用户发来一个文件，但下载失败了。'
      return { text: failure, images: [] }
    }
  }

  /** 附件归档失败不影响这一轮回复：记一笔日志，继续用内存里的数据。 */
  async function archiveBuffer(buffer, fileName) {
    try {
      await fs.mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 })
      const path = join(HISTORY_DIR, fileName)
      await fs.writeFile(path, buffer, { mode: 0o600 })
      return path
    } catch (error) {
      log.warn(`feishu-channel: failed to archive ${fileName}: ${String(error)}`)
      return undefined
    }
  }

  /** 图片必须先进入 durable attachment store 才能作为消息内容；失败时降级成纯文字。 */
  async function userContent(prepared) {
    if (prepared.images.length === 0) return [{ type: 'text', text: prepared.text }]
    try {
      return await ctx.attachments.admitPromptContent([
        { type: 'text', text: prepared.text },
        ...prepared.images.map((image) => ({
          type: 'image',
          data: image.data.toString('base64'),
          mediaType: image.mediaType,
          ...(image.name === undefined ? {} : { name: image.name }),
        })),
      ])
    } catch (error) {
      log.warn(`feishu-channel: failed to admit inbound image: ${String(error)}`)
      console.warn(`feishu-channel: failed to admit inbound image: ${String(error)}`)
      return [{ type: 'text', text: `${prepared.text}\n\n（图片读取失败，暂时看不到这张图片。）` }]
    }
  }

  /** 流式写入历史目录；超限或失败时删掉半成品，绝不留残缺文件。 */
  async function downloadToFile(messageId, fileKey, type, limit, fileName) {
    const res = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    })
    if (res?.code !== undefined && res.code !== 0) throw new Error(`Lark API ${res.code}: ${res.msg}`)
    const contentType = String(res.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const stream = typeof res.getReadableStream === 'function' ? res.getReadableStream() : res
    await fs.mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 })
    const path = join(HISTORY_DIR, fileName)
    const tempPath = `${path}.part-${randomUUID()}`
    const handle = await fs.open(tempPath, 'w', 0o600)
    let size = 0
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > limit) {
          stream.destroy?.()
          throw new Error(`resource exceeds ${limit} bytes`)
        }
        await handle.write(buffer)
      }
      await handle.close()
      await fs.rename(tempPath, path)
      return { path, size, contentType }
    } catch (error) {
      await handle.close().catch(() => undefined)
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async function downloadToBuffer(messageId, fileKey, type, limit) {
    const res = await client.im.messageResource.get({
      path: { message_id: messageId, file_key: fileKey },
      params: { type },
    })
    if (res?.code !== undefined && res.code !== 0) throw new Error(`Lark API ${res.code}: ${res.msg}`)
    const stream = typeof res.getReadableStream === 'function' ? res.getReadableStream() : res
    const buffer = await streamToBuffer(stream, limit)
    const contentType = String(res.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    return { buffer, contentType }
  }

  /** 拿到这个 chat 当天 Session 的 live Agent；没有就恢复；恢复失败（从没存在过）就新建。 */
  async function ensureAgent(chatId, chatType) {
    const sessionId = sessionIdFor(chatId)
    const live = ctx.agents.get(sessionId)
    if (live !== undefined) return live

    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if (!('error' in resolved)) return resolved.agent
    if (resolved.error.code !== 'session/not-found') throw resolved.error

    // create() 会同时建 Session 与它的 Agent；agentPreset 决定它能用哪些工具。
    // preset 只在创建时固定：今天的旧会话要等按天轮换才换 preset。
    const preset = presetFor(chatId, chatType)
    const created = await ctx.sessionController.create({
      sessionId,
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      ...(preset === undefined ? {} : { agentPreset: preset }),
    })
    if (created.sessionId !== sessionId) {
      log.warn(`feishu-channel: requested ${sessionId}, got ${created.sessionId}; using the returned id for this chat`)
      rememberSessionId(chatId, created.sessionId)
    }
    // logger 不进 journal，排查用 console 单独打一行（不带消息正文）。
    console.info(`feishu-channel: created session ${created.sessionId} preset=${preset ?? 'default'}`)

    const liveAfterCreate = ctx.agents.get(created.sessionId)
    if (liveAfterCreate !== undefined) return liveAfterCreate

    const retried = await ctx.sessionController.resolveAgent(created.sessionId)
    if ('error' in retried) throw retried.error
    return retried.agent
  }

  /** 只有主人私聊用高权限 preset；chat_type 和 chat_id 都来自飞书，消息内容改不了它们。 */
  function isOwnerChat(chatId, chatType) {
    return chatType === 'p2p' && config.ownerChatId !== '' && chatId === config.ownerChatId
  }

  function presetFor(chatId, chatType) {
    return isOwnerChat(chatId, chatType) ? config.ownerPreset : config.agentPreset
  }

  function timeoutFor(chatId, chatType) {
    return isOwnerChat(chatId, chatType) ? config.ownerReplyTimeoutMs : config.replyTimeoutMs
  }

  function sessionIdFor(chatId) {
    const date = dateStamp()
    const cached = sessionIds.get(chatId)
    if (cached?.date === date) return cached.sessionId
    const sessionId = `${config.sessionPrefix}${chatId}-${date}`
    sessionIds.set(chatId, { date, sessionId })
    return sessionId
  }

  function rememberSessionId(chatId, sessionId) {
    const cached = sessionIds.get(chatId)
    if (cached !== undefined) cached.sessionId = sessionId
  }

  function dateStamp() {
    // en-CA 的日期格式就是 YYYY-MM-DD，去掉连字符即 YYYYMMDD。
    return dateFormatter.format(new Date()).replaceAll('-', '')
  }

  /** 等这一轮跑完。whenIdle() 会跟着 activity 链走，所以“正在跑 + 队列里还有”也会一起等。 */
  function waitIdle(agent, timeoutMs = config.replyTimeoutMs) {
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

  /** 与 @deepseek-ai/dsh-llm 的 createUserMessage 等价：MessageBase = { id, content, source }。 */
  function userMessage(content) {
    return {
      id: randomUUID(),
      role: 'user',
      content,
      source: { kind: 'user' },
    }
  }

  /** 取一条 assistant/message 事件里的可见文本；纯工具调用步骤返回空串。 */
  function assistantText(event) {
    if (event?.type !== 'assistant/message') return ''
    const content = event.data?.message?.content ?? []
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
  }

  // --- 出站 -------------------------------------------------------------
  async function sendText(messageId, text) {
    for (const chunk of split(text, REPLY_CHUNK)) {
      await client.im.message.reply({
        path: { message_id: messageId },
        data: {
          // msg_type=post 的 md 节点：飞书按 CommonMark + GFM 渲染 Markdown。
          msg_type: 'post',
          content: JSON.stringify({ zh_cn: { content: [[{ tag: 'md', text: chunk }]] } }),
        },
      })
    }
  }
}

/** 飞书 text 消息的 content 是 JSON 字符串；群聊 @ 会留 `@_user_N` 占位符，用 mentions 还原。 */
function parseText(content, mentions) {
  const text = parseJson(content)?.text ?? ''
  let restored = String(text)
  for (const mention of mentions ?? []) {
    if (mention?.key) restored = restored.replaceAll(mention.key, mention.name ?? '')
  }
  return restored.trim()
}

/** 富文本（post）收上来是 {title, content:[[{tag,...}]]}；拼回纯文本，并收集内嵌图片的 key。 */
function parsePost(content, mentions) {
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

function parseJson(content) {
  try {
    const value = JSON.parse(content ?? '{}')
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** 图片格式判定：先看 Content-Type，再看文件名后缀，最后嗅探文件头。 */
function imageMediaType(contentType, buffer, name = '') {
  if (IMAGE_MEDIA_TYPES.has(contentType)) return contentType
  const byName = IMAGE_FILE_TYPES.get(extensionOf(name))
  if (byName !== undefined) return byName
  if (buffer.length >= 12) {
    const head = buffer.subarray(0, 12).toString('latin1')
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
    if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'image/gif'
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  }
  return undefined
}

function isTextFile(name, contentType) {
  return contentType.startsWith('text/') || TEXT_FILE_TYPES.has(extensionOf(name))
}

/** 归档文件名：消息 id + 序号 + 净化后的原名，避免重名和路径穿越。 */
function historyName(messageId, index, name, mediaType = '') {
  const safe = safeFileName(name)
  if (safe !== '') return `${messageId}-${index}-${safe}`
  const ext = IMAGE_EXTENSIONS.get(mediaType)
  return ext === undefined ? `${messageId}-${index}.bin` : `${messageId}-${index}.${ext}`
}

function safeFileName(name) {
  if (typeof name !== 'string' || name === '') return ''
  const base = name.split(/[\\/]/).pop() ?? ''
  return base.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '').slice(0, 120)
}

function mimeSuffix(contentType) {
  return contentType === '' ? '' : `，${contentType}`
}

/** 只读文件开头；群聊内联文本文件时用，不把整个文件读进内存。 */
async function readTextPrefix(path, limit) {
  const handle = await fs.open(path, 'r')
  try {
    const buffer = Buffer.alloc(limit)
    const { bytesRead } = await handle.read(buffer, 0, limit, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close().catch(() => undefined)
  }
}

/** 把 SDK 返回的二进制流读进内存；超过上限直接中断，防止超大文件撑爆进程。 */
async function streamToBuffer(stream, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > limit) {
      stream.destroy?.()
      throw new Error(`resource exceeds ${limit} bytes`)
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function split(text, size) {
  const chars = Array.from(text)
  const out = []
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''))
  return out.length === 0 ? [''] : out
}
