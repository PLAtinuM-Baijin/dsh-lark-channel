/**
 * preset 工具挂载的纯函数：把 cordis 条目里的 plugins 行树投影给浏览器，
 * 以及按路径切换某一行的 disabled。
 *
 * 行的原始值可能带 `!!js` 表达式（Loader 表示为 { __jsExpr: '...' }），
 * 这里原样保留：只描述、只改目标行的 disabled，不碰其他字段。
 */

export function isJsExpr(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.__jsExpr === 'string'
  )
}

export function describePlugins(plugins) {
  return walk(Array.isArray(plugins) ? plugins : [], [])

  function walk(rows, prefix) {
    const out = []
    rows.forEach((row, index) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return
      const path = [...prefix, index]
      const node = {
        path,
        id: typeof row.id === 'string' ? row.id : null,
        name: typeof row.name === 'string' ? row.name : '',
        group: row.group === true,
      }
      if (isJsExpr(row.disabled)) node.condition = row.disabled.__jsExpr
      else node.disabled = row.disabled === true
      if (node.group && Array.isArray(row.config)) node.children = walk(row.config, path)
      out.push(node)
    })
    return out
  }
}

export function validPath(path) {
  return (
    Array.isArray(path) &&
    path.length > 0 &&
    path.length <= 8 &&
    path.every((index) => Number.isInteger(index) && index >= 0)
  )
}

/**
 * 返回 plugins 的深拷贝，目标行的 disabled 置为 true（禁用）或删除（启用）。
 * 启用时删除字段而不是写 false，让该行回到默认启用语义。
 */
export function setPluginDisabled(plugins, path, disabled) {
  if (!validPath(path)) throw new Error('工具行路径无效')
  const clone = structuredClone(Array.isArray(plugins) ? plugins : [])
  let rows = clone
  let row
  for (let depth = 0; depth < path.length; depth += 1) {
    if (!Array.isArray(rows)) throw new Error('工具行路径无效')
    const index = path[depth]
    if (index >= rows.length) throw new Error('工具行路径无效')
    row = rows[index]
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('工具行路径无效')
    if (depth < path.length - 1) {
      if (row.group !== true || !Array.isArray(row.config)) throw new Error('工具行路径无效')
      rows = row.config
    }
  }
  if (disabled) row.disabled = true
  else delete row.disabled
  return clone
}
