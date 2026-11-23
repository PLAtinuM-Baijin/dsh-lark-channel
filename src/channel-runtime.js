/**
 * Host 插件（index.js）与 preset 工具（send-text / schedule-tool / reply-tool）之间的窄接口。
 *
 * dsh 一个进程只跑一个 feishu-channel 实例：channel 在 apply() 里注册运行时，
 * 工具通过 getChannelRuntime() 拿到它。工具因此不用自己建客户端，也不关心
 * session 怎么唤起；白名单校验和发送都复用 channel 里的同一套逻辑。
 *
 * 接口：
 *   createTask / listTasks / cancelTask —— 定时任务
 *   sendChatText —— 主动发一条新消息
 *   setDelivery —— 选择当前轮的发送方式（引用回复 / 直接发送）
 */
let runtime

export function setChannelRuntime(value) {
  runtime = value
}

export function getChannelRuntime() {
  return runtime
}
