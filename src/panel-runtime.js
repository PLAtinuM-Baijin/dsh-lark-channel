/**
 * channel ↔ 面板之间的运行时注册表。
 *
 * 面板是独立的 Loader 条目（ui/index.js），与 channel 在同一个 node 进程里，
 * 且两边解析到同一个绝对路径的这个模块；因此用模块级变量共享一份状态。
 * channel 卸载时 setPanelRuntime 返回的 disposer 会把注册清掉。
 */
let runtime

export function setPanelRuntime(next) {
  runtime = next
  return () => {
    if (runtime === next) runtime = undefined
  }
}

export function getPanelRuntime() {
  return runtime
}
