/**
 * 记忆整理插件 ↔ 面板之间的运行时注册表；
 * 与 panel-runtime.js 同理，靠同进程内共享的模块实例传递状态。
 */
let runtime

export function setCuratorRuntime(next) {
  runtime = next
  return () => {
    if (runtime === next) runtime = undefined
  }
}

export function getCuratorRuntime() {
  return runtime
}
