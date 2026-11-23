/**
 * 面板参数的纯函数：settings.describe 行投影、写入校验、路由前缀归一化。
 * 不依赖 cordis/schemastery，Node 测试可以直接加载。
 */

const EDITABLE_TYPES = new Set(['boolean', 'number', 'string', 'array'])

/** 把 settings.describe 的 volatile form 投影成面板可渲染的字段清单。 */
export function describeParams(row) {
  const schema = row?.schema
  const refs = schema !== null && typeof schema === 'object' ? schema.refs : undefined
  const root = refs?.[schema?.uid]
  const fields = []
  const dict = root !== undefined && root.type === 'object' ? root.dict : undefined
  if (dict === undefined || refs === undefined) return { ns: row?.ns, revision: row?.revision, fields }

  for (const [field, refId] of Object.entries(dict)) {
    const ref = refs[refId]
    if (ref === undefined || !EDITABLE_TYPES.has(ref.type)) continue
    const meta = ref.meta ?? {}
    const spec = {
      name: field,
      type: ref.type,
      description: typeof meta.description === 'string' ? meta.description : '',
      default: meta.default === undefined ? null : meta.default,
      value: row.value?.[field] ?? meta.default ?? null,
    }
    if (ref.type === 'array') {
      const inner = refs[ref.inner]
      spec.itemType = inner?.type === 'number' ? 'number' : 'string'
    }
    fields.push(spec)
  }
  return { ns: row?.ns, revision: row?.revision, fields }
}

/** 写入前按 schema 类型校验；字符串数组顺手去掉空项和首尾空格。 */
export function checkParamValue(field, value) {
  if (field.type === 'boolean') {
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: '必须是布尔值' }
  }
  if (field.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false, error: '必须是数字' }
  }
  if (field.type === 'string') {
    return typeof value === 'string' ? { ok: true, value } : { ok: false, error: '必须是字符串' }
  }
  if (field.type === 'array') {
    if (!Array.isArray(value)) return { ok: false, error: '必须是数组' }
    if (field.itemType === 'number') {
      return value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
        ? { ok: true, value }
        : { ok: false, error: '元素必须是数字' }
    }
    if (!value.every((entry) => typeof entry === 'string')) return { ok: false, error: '元素必须是字符串' }
    return { ok: true, value: value.map((entry) => entry.trim()).filter(Boolean) }
  }
  return { ok: false, error: '类型不支持' }
}

export function normalizeBase(value) {
  const raw = typeof value === 'string' && value.trim() !== '' ? value.trim() : '/feishu-panel'
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
}
