import { homedir } from 'node:os'
import { join } from 'node:path'

/** 与 package.json 的 version 保持一致；面板启动信息里展示。 */
export const VERSION = '0.1.0'
/** 单条飞书富文本（post）消息的拆块阈值；post 官方上限 30KB，3500 字符留足余量。 */
export const REPLY_CHUNK = 3500
/** 去重表最多记多少条 message_id；WS 重连时飞书可能重投最近的事件。 */
export const SEEN_LIMIT = 1000
/** 最近消息摘要表的上限；撤回事件只带 message_id，要靠这里还原是哪条。 */
export const RECENT_LIMIT = 500
/** 已交给 agent、尚未被领取的消息最多跟踪多少条（防止异常情况下无限增长）。 */
export const PENDING_LIMIT = 200
/** 已发送 seq 的去重表上限。 */
export const DELIVERED_LIMIT = 2000
/** 流式卡片的文本元素 id：字母开头，只含字母数字下划线，≤20 字符。 */
export const CARD_ELEMENT_ID = 'content'
/** 流式卡片推送最短间隔；单卡 CardKit 操作上限约 10 次/秒，120ms 留余量。 */
export const CARD_PUSH_INTERVAL_MS = 120
/** 客户端打字机上屏节奏：20ms 打 8 字 ≈ 400 字/秒，明显快于模型产出，避免队列积压。 */
export const CARD_PRINT_INTERVAL_MS = 20
export const CARD_PRINT_STEP = 8
export const CARD_PRINT_RATE = (CARD_PRINT_STEP * 1000) / CARD_PRINT_INTERVAL_MS
/** 卡片正文的保守上限；超长时卡片只显示截断文本，完整内容改用普通消息补发。 */
export const CARD_TEXT_LIMIT = 8000
/** 定时任务的扫描间隔；个人提醒精度 ±5 秒足够，单次扫描开销很小。 */
export const SCHEDULE_TICK_MS = 5000
/** waitIdle 超时的内部标记。 */
export const TURN_TIMEOUT = Symbol('feishu-channel/turn-timeout')
/** 超时取消后，等取消动作落盘（可能带一小段部分文本）的上限。 */
export const CANCEL_SETTLE_MS = 5000
/** 下载到的所有附件统一归档到这里；不自动清理，磁盘由使用者负责。 */
export const HISTORY_DIR = join(homedir(), 'feishu-history', 'files')
/** 普通文件、语音、视频的下载上限；流式写盘，不占进程内存。 */
export const FILE_DOWNLOAD_LIMIT = 50 * 1024 * 1024
/** 图片上限仍按 attachment 的单图限制，超过就无法作为 image block 交给模型。 */
export const IMAGE_DOWNLOAD_LIMIT = 20 * 1024 * 1024
/** 文本文件最多内联多少字节；更长的只取开头。 */
export const TEXT_FILE_LIMIT = 64 * 1024
/** 引用消息正文的展示上限；只给模型引用的大意，避免撑爆上下文。 */
export const QUOTE_TEXT_LIMIT = 4000
/** 网页问题镜像到飞书时最多保留多少字符；超长粘贴只发开头。 */
export const WEB_MIRROR_QUESTION_LIMIT = 4000
/** 引用消息里最多下载几张图片；与普通富文本一致，作为 image block 交给模型。 */
export const QUOTE_IMAGE_LIMIT = 4
/** 合并转发最多展开多少条子消息、正文总共多少字符；超出部分只给一句说明。 */
export const MERGE_FORWARD_LIMIT = 50
export const MERGE_FORWARD_TEXT_LIMIT = 12000
/** 只处理这些消息类型；卡片、系统消息等直接忽略。 */
export const HANDLED_MESSAGE_TYPES = new Set(['text', 'post', 'image', 'file', 'audio', 'media', 'merge_forward'])
/** 能直接作为 image block 交给模型的格式（与 attachment-local 的 imageLimits 一致）。 */
export const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
export const IMAGE_FILE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
])
/** image 媒体类型 → 归档后缀（用于没有原始文件名的图片）。 */
export const IMAGE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])
/** 按扩展名判断为可内联文本的文件类型。 */
export const TEXT_FILE_TYPES = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env',
  '.csv', '.tsv', '.log', '.tex', '.properties', '.gradle', '.ipynb',
  '.xml', '.html', '.htm', '.css', '.scss', '.less', '.svg',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
  '.py', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cc', '.cs', '.go', '.rs', '.rb', '.php',
  '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1', '.sql', '.lua', '.pl', '.swift', '.dart', '.r', '.m',
])
