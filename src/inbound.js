/**
 * 入站消息：结构解析、撤回摘要、引用/合并转发读取、附件下载与归档。
 * 纯函数（parseInbound / summarizeInbound / renderMergedForward）直接导出；
 * 需要飞书 client、日志和附件存储的部分由 createInbound 工厂注入。
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import {
  FILE_DOWNLOAD_LIMIT,
  HISTORY_DIR,
  IMAGE_DOWNLOAD_LIMIT,
  IMAGE_FILE_TYPES,
  MERGE_FORWARD_LIMIT,
  MERGE_FORWARD_TEXT_LIMIT,
  QUOTE_IMAGE_LIMIT,
  QUOTE_TEXT_LIMIT,
  TEXT_FILE_LIMIT,
} from './constants.js'
import {
  checkLark,
  describeLarkError,
  errorText,
  extensionOf,
  historyName,
  imageMediaType,
  isTextFile,
  mimeSuffix,
  readTextPrefix,
  safeFileName,
  streamToBuffer,
} from './lark-utils.js'
import { messageItemText, parseJson, parsePost, parseText } from './message-format.js'
import { clip, shorten } from './text-utils.js'

/** 事件阶段只解析结构；真正的资源下载等排到这个 chat 的队列里再做。 */
export function parseInbound(message) {
  // 引用/回复会带 parent_id；被引用内容稍后在 prepareInbound 里按 id 读回。
  const quoteId = typeof message.parent_id === 'string' && message.parent_id !== '' ? message.parent_id : undefined
  const quote = quoteId === undefined ? {} : { quoteId }
  switch (message.message_type) {
    case 'text': {
      const text = parseText(message.content, message.mentions)
      // 只 @ 了机器人、没写正文也没有引用：没有可回答的内容。
      if (text === '' && quoteId === undefined) return null
      return { kind: 'text', text, ...quote }
    }
    case 'post': {
      // 富文本可以把 @ 和图片放在同一条消息里，是群聊里唯一能带图触达的形态。
      const { text, imageKeys } = parsePost(message.content, message.mentions)
      if (text === '' && imageKeys.length === 0 && quoteId === undefined) return null
      return { kind: 'post', text, imageKeys, ...quote }
    }
    case 'image': {
      const content = parseJson(message.content)
      if (typeof content?.image_key !== 'string') return null
      return { kind: 'image', fileKey: content.image_key, ...quote }
    }
    case 'file': {
      const content = parseJson(message.content)
      if (typeof content?.file_key !== 'string') return null
      return { kind: 'file', fileKey: content.file_key, fileName: content.file_name, ...quote }
    }
    case 'audio': {
      const content = parseJson(message.content)
      const duration = Number(content?.duration)
      const seconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration / 1000) : undefined
      const notice = `用户发来一条语音${seconds === undefined ? '' : `（约 ${seconds} 秒）`}。我现在还不能收听或转写语音，请直接告诉用户。`
      if (typeof content?.file_key !== 'string') return { kind: 'other', text: notice, ...quote }
      return {
        kind: 'audio',
        fileKey: content.file_key,
        fileName: typeof content.file_name === 'string' && content.file_name !== '' ? content.file_name : undefined,
        durationSeconds: seconds,
        notice,
        ...quote,
      }
    }
    case 'media': {
      const content = parseJson(message.content)
      const name = typeof content?.file_name === 'string' && content.file_name !== '' ? content.file_name : undefined
      const shownName = name === undefined ? '' : safeFileName(name)
      const duration = Number(content?.duration)
      const seconds = Number.isFinite(duration) && duration > 0 ? Math.round(duration / 1000) : undefined
      const nameText = shownName === '' ? '' : `「${shownName}」`
      const durationText = seconds === undefined ? '' : `（约 ${seconds} 秒）`
      const notice = `用户发来一个视频${nameText}${durationText}。我现在还不能处理视频，请直接告诉用户。`
      if (typeof content?.file_key !== 'string') return { kind: 'other', text: notice, ...quote }
      return {
        kind: 'media',
        fileKey: content.file_key,
        fileName: name,
        durationSeconds: seconds,
        notice,
        ...quote,
      }
    }
    case 'merge_forward':
      // 事件里的内容固定是 "Merged and Forwarded Message"；子消息在 prepare 阶段按 id 读。
      return { kind: 'merge_forward', ...quote }
    default:
      return null
  }
}

/** 撤回提醒里只带一小段摘要，别把整条长消息塞进提示。 */
export function summarizeInbound(inbound) {
  const base = summarizeKind(inbound)
  return inbound.quoteId === undefined ? base : `（引用了另一条消息）${base}`
}

function summarizeKind(inbound) {
  switch (inbound.kind) {
    case 'text':
      return shorten(inbound.text.replaceAll('\n', ' '), 120)
    case 'post': {
      const text = shorten(inbound.text.replaceAll('\n', ' '), 120)
      const images = inbound.imageKeys.length === 0 ? '' : `（含 ${inbound.imageKeys.length} 张图片）`
      return `${text}${images}`
    }
    case 'file':
      return `文件「${safeFileName(inbound.fileName) || '未命名'}」`
    case 'image':
      return '一张图片'
    case 'audio':
      return '一条语音'
    case 'media':
      return '一个视频'
    case 'merge_forward':
      return '合并转发的聊天记录'
    default:
      return shorten(String(inbound.text ?? '').replaceAll('\n', ' '), 120)
  }
}

/** 合并转发渲染：items 是 message.get 返回的父消息 + 子消息列表。 */
export function renderMergedForward(items, messageId) {
  const children = items.filter((item) => item.upper_message_id === messageId)
  const list = children.length > 0 ? children : items.filter((item) => item.message_id !== messageId)
  if (list.length === 0) {
    return '[用户合并转发了一组聊天记录，但里面读不到任何消息。请如实告诉用户。]'
  }
  const lines = [
    `[合并转发的聊天记录，共 ${list.length} 条${list.length > MERGE_FORWARD_LIMIT ? `，只展开前 ${MERGE_FORWARD_LIMIT} 条` : ''}]`,
  ]
  let used = 0
  for (const [index, item] of list.entries()) {
    if (index >= MERGE_FORWARD_LIMIT) break
    const { text } = messageItemText(item)
    const sender = item.sender?.sender_type === 'app' ? '机器人' : item.sender?.id ?? '未知'
    const line = `${index + 1}. (${sender}) ${clip(text.replaceAll('\n', '\n   '), 2000)}`
    if (used + line.length > MERGE_FORWARD_TEXT_LIMIT) {
      lines.push(`（其余 ${list.length - index} 条超过读取上限，未展开）`)
      break
    }
    used += line.length
    lines.push(line)
  }
  return lines.join('\n')
}

export function createInbound({ client, log, attachments }) {
  /** 把一条入站消息变成「给模型的文字 + 待入库的图片」；下载/归档/格式问题只降级不抛错。 */
  async function prepareInbound(messageId, inbound, owner) {
    const prepared = await prepareMainInbound(messageId, inbound, owner)
    if (inbound.quoteId === undefined) return prepared
    // 被引用的消息按 parent_id 单独读回；失败只降级成一句说明，不影响本条消息。
    const quoted = await prepareQuoted(inbound.quoteId)
    return {
      text: [quoted.text, prepared.text].filter((part) => part !== '').join('\n\n'),
      images: [...quoted.images, ...prepared.images],
    }
  }

  async function prepareMainInbound(messageId, inbound, owner) {
    if (inbound.kind === 'merge_forward') return { text: await describeMergedForward(messageId), images: [] }
    if (inbound.kind === 'text' || inbound.kind === 'other') return { text: inbound.text, images: [] }

    try {
      if (inbound.kind === 'post') {
        const images = []
        const failures = []
        for (const [index, imageKey] of inbound.imageKeys.entries()) {
          try {
            const { buffer, contentType } = await downloadToBuffer(messageId, imageKey, 'image', IMAGE_DOWNLOAD_LIMIT)
            const mediaType = imageMediaType(contentType, buffer)
            await archiveBuffer(buffer, historyName(messageId, index, '', mediaType ?? contentType))
            if (mediaType !== undefined) images.push({ data: buffer, mediaType })
          } catch (error) {
            // 一张图失败不影响其余图片和正文，但原因要带给模型。
            const reason = errorText(error)
            failures.push(reason)
            log.warn(`feishu-channel: failed to fetch post image ${imageKey}: ${reason}`)
          }
        }
        if (images.length === 0 && failures.length > 0) {
          return {
            text: `用户发来的富文本里有图片，但下载失败了（${shorten(failures[0], 500)}）。请如实告诉用户，不要猜测图片内容。`,
            images,
          }
        }
        const text = inbound.text === '' ? '用户发来的富文本里有图片，请查看。' : inbound.text
        const note = failures.length === 0 ? '' : `\n\n（另有 ${failures.length} 张图片下载失败：${shorten(failures[0], 500)}）`
        return { text: `${text}${note}`, images }
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
      const reason = errorText(error)
      log.warn(`feishu-channel: failed to fetch resource for ${messageId}: ${reason}`)
      console.warn(`feishu-channel: failed to fetch resource for ${messageId}: ${reason}`)
      const failure =
        inbound.kind === 'image' ? '用户发来一张图片，但下载失败了'
          : inbound.kind === 'audio' ? '用户发来一条语音，但下载失败了'
            : inbound.kind === 'media' ? '用户发来一个视频，但下载失败了'
              : '用户发来一个文件，但下载失败了'
      return { text: `${failure}（${shorten(reason, 500)}）。请如实告诉用户，不要猜测内容。`, images: [] }
    }
  }

  /**
   * 引用消息：按 parent_id 走「获取指定消息的内容」单条读回，不用拉群历史的重权限
   * （与旧 Claude Code 版 feishu_im_get_message 同一套做法）。引用里的图片也下载给模型看。
   */
  async function prepareQuoted(quoteId) {
    try {
      const items = await getMessageItems(quoteId)
      const [item] = items
      const { text, imageKeys } =
        item.msg_type === 'merge_forward'
          ? { text: renderMergedForward(items, item.message_id ?? quoteId), imageKeys: [] }
          : messageItemText(item)
      const quotedMessageId = item.message_id ?? quoteId
      const images = []
      let failed = 0
      for (const [index, imageKey] of imageKeys.slice(0, QUOTE_IMAGE_LIMIT).entries()) {
        try {
          const { buffer, contentType } = await downloadToBuffer(
            quotedMessageId,
            imageKey,
            'image',
            IMAGE_DOWNLOAD_LIMIT,
          )
          const mediaType = imageMediaType(contentType, buffer)
          await archiveBuffer(buffer, historyName(quotedMessageId, index, '', mediaType ?? contentType))
          if (mediaType !== undefined) images.push({ data: buffer, mediaType })
        } catch (error) {
          failed += 1
          log.warn(`feishu-channel: failed to fetch quoted image ${imageKey}: ${errorText(error)}`)
        }
      }
      const sender = item.sender?.sender_type === 'app' ? '机器人' : item.sender?.id ?? '未知'
      const note = failed === 0 ? '' : `（另有 ${failed} 张图片读取失败）`
      return {
        text: `[引用消息｜发送者 ${sender}]\n${clip(text, QUOTE_TEXT_LIMIT)}${note}`,
        images,
      }
    } catch (error) {
      const reason = errorText(error)
      log.warn(`feishu-channel: failed to read quoted message ${quoteId}: ${reason}`)
      console.warn(`feishu-channel: failed to read quoted message ${quoteId}: ${reason}`)
      return {
        text: `[用户引用了一条消息，但读取失败：${shorten(reason, 300)}。请如实告诉用户你看不到被引用的内容，不要猜测。]`,
        images: [],
      }
    }
  }

  /** 合并转发：同一接口返回父消息和全部子消息（子消息的 upper_message_id 指向父消息）。 */
  async function describeMergedForward(messageId) {
    try {
      return renderMergedForward(await getMessageItems(messageId), messageId)
    } catch (error) {
      const reason = errorText(error)
      log.warn(`feishu-channel: failed to read merged forward ${messageId}: ${reason}`)
      console.warn(`feishu-channel: failed to read merged forward ${messageId}: ${reason}`)
      return `[用户合并转发了一组聊天记录，但读取失败：${shorten(reason, 300)}。请如实告诉用户，不要猜测里面的内容。]`
    }
  }

  /**
   * 按 message_id 读消息；HTTP 错误和业务错误都转成可读原因。
   * 卡片消息要带 card_msg_content_type=user_card_content 才返回可解析的
   * 卡片 JSON（schema "2.0"，正文在 body.elements[].content）；不带时
   * 返回的常是卡片引用/模板信封，提取不到文字。
   */
  async function getMessageItems(messageId) {
    let res
    try {
      res = await client.im.message.get({
        path: { message_id: messageId },
        params: { card_msg_content_type: 'user_card_content' },
      })
    } catch (error) {
      throw new Error(await describeLarkError(error))
    }
    checkLark(res)
    const items = res?.data?.items
    if (!Array.isArray(items) || items.length === 0) throw new Error('消息不存在或不可读')
    return items
  }

  /** 删除某条消息归档的附件副本；撤回时调用。 */
  async function deleteArchived(messageId) {
    let names
    try {
      names = await fs.readdir(HISTORY_DIR)
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn(`feishu-channel: failed to list history for ${messageId}: ${String(error)}`)
      return
    }
    let removed = 0
    for (const name of names) {
      if (!name.startsWith(`${messageId}-`) || name.includes('.part-')) continue
      try {
        await fs.rm(join(HISTORY_DIR, name), { force: true })
        removed += 1
      } catch (error) {
        log.warn(`feishu-channel: failed to delete archived ${name}: ${String(error)}`)
      }
    }
    if (removed > 0) log.info(`feishu-channel: deleted ${removed} archived file(s) of recalled message ${messageId}`)
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
      return await attachments.admitPromptContent([
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

  /** messageResource.get 的 4xx 错误体是流；先提取飞书的 code/msg，再作为可读原因抛出。 */
  async function getResource(messageId, fileKey, type) {
    try {
      return await client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type },
      })
    } catch (error) {
      throw new Error(await describeLarkError(error))
    }
  }

  /** 流式写入历史目录；超限或失败时删掉半成品，绝不留残缺文件。 */
  async function downloadToFile(messageId, fileKey, type, limit, fileName) {
    const res = await getResource(messageId, fileKey, type)
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
    const res = await getResource(messageId, fileKey, type)
    if (res?.code !== undefined && res.code !== 0) throw new Error(`Lark API ${res.code}: ${res.msg}`)
    const stream = typeof res.getReadableStream === 'function' ? res.getReadableStream() : res
    const buffer = await streamToBuffer(stream, limit)
    const contentType = String(res.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    return { buffer, contentType }
  }

  return { prepareInbound, deleteArchived, userContent }
}
