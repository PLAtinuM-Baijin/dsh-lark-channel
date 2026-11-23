/**
 * 飞书面板的 Host 半身。
 *
 * 独立的 Loader 条目（包名 @local/dsh-feishu-panel），不依赖 channel 的
 * 模块身份：channel 把状态/动作注册进 panel-runtime.js，这里按需读取。
 *
 * 路由（全部走 connection.requestRejection 的登录与 Host/Origin 校验）：
 *   GET  /feishu-panel/state   通道、会话、任务、整理器、记忆概览
 *   GET  /feishu-panel/memory  全局或某个 chat 的记忆明细
 *   GET  /feishu-panel/params  可热改字段（volatile）与 revision
 *   POST /feishu-panel/params  提交字段修改；并发修改返回 409
 *   GET  /feishu-panel/tools   agent preset 的工具行树
 *   POST /feishu-panel/tools   切换某个工具行的 disabled
 *   POST /feishu-panel/action  手动整理 / 发测试消息 / 取消定时任务
 *
 * 参数读写全部委托给 Host 的 settings 服务（profile 的 cordis.patch.yml），
 * 因此和「设置」页面改的是同一份配置，刷新后以文件为准。
 * 工具挂载走 configEditor：校验后写回 profile patch，并热重载 preset 条目。
 */
import Schema from '@deepseek-ai/schemastery'
import { getPanelRuntime } from '../src/panel-runtime.js'
import { checkParamValue, describeParams, normalizeBase } from './params.js'
import { describePlugins, setPluginDisabled, validPath } from './presets.js'

export const name = 'feishu-panel'
export const inject = ['webServer', 'connection']

export const Config = Schema.object({
  ns: Schema.string().default('feishu-channel').description('被管理条目的 profile id（也是 settings 命名空间）'),
  routeBase: Schema.string().default('/feishu-panel').description('面板 JSON 路由前缀'),
})

const MAX_BODY_BYTES = 64 * 1024

export function apply(ctx, config) {
  const log = ctx.logger
  const base = normalizeBase(config.routeBase)
  // webserver 的 exact 路由按路径去重（同一个 path 只能有一个 handler），
  // 所以一个路径上的多个方法在 handler 内部分派。
  const routes = [
    ['/state', { GET: handleState }],
    ['/memory', { GET: handleMemory }],
    ['/params', { GET: handleParamsRead, POST: handleParamsWrite }],
    ['/tools', { GET: handleToolsRead, POST: handleToolsWrite }],
    ['/action', { POST: handleAction }],
  ]
  for (const [suffix, methods] of routes) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path: `${base}${suffix}`, handler: guard(methods) }),
      `feishu-panel: ${base}${suffix}`,
    )
  }

  function guard(methods) {
    return (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        sendJson(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' })
        return
      }
      const handler = methods[req.method]
      if (handler === undefined) {
        res.setHeader('allow', Object.keys(methods).join(', '))
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      Promise.resolve()
        .then(() => handler(req, res))
        .catch((error) => {
          log.warn(`feishu-panel: ${req.method} ${req.url ?? ''} failed: ${String(error)}`)
          if (!res.headersSent) sendJson(res, 500, { error: String(error?.message ?? error) })
          else res.end()
        })
    }
  }

  async function handleState(req, res) {
    const runtime = panelRuntime(res)
    if (runtime === undefined) return
    sendJson(res, 200, await runtime.snapshot())
  }

  async function handleMemory(req, res) {
    const runtime = panelRuntime(res)
    if (runtime === undefined) return
    const chatId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('chat') ?? ''
    try {
      sendJson(res, 200, runtime.memoryChat(chatId))
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
    }
  }

  async function handleParamsRead(req, res) {
    const settings = settingsService()
    if (settings === undefined) {
      sendJson(res, 503, { error: '当前 profile 没有 settings 服务' })
      return
    }
    const row = settings.describe().find((entry) => entry.ns === config.ns)
    if (row === undefined) {
      sendJson(res, 503, { error: `找不到可配置的插件条目 ${config.ns}` })
      return
    }
    sendJson(res, 200, describeParams(row))
  }

  async function handleParamsWrite(req, res) {
    const settings = settingsService()
    if (settings === undefined) {
      sendJson(res, 503, { error: '当前 profile 没有 settings 服务' })
      return
    }
    const body = await readJsonBody(req)
    const patch = body?.patch
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      sendJson(res, 400, { error: '缺少 patch 对象' })
      return
    }
    const revision = Number.isSafeInteger(body?.revision) ? body.revision : undefined

    const row = settings.describe().find((entry) => entry.ns === config.ns)
    if (row === undefined) {
      sendJson(res, 503, { error: `找不到可配置的插件条目 ${config.ns}` })
      return
    }
    const fields = new Map(describeParams(row).fields.map((field) => [field.name, field]))
    const clean = {}
    for (const [field, value] of Object.entries(patch)) {
      const spec = fields.get(field)
      if (spec === undefined) {
        sendJson(res, 400, { error: `字段 ${field} 不可从面板修改` })
        return
      }
      const checked = checkParamValue(spec, value)
      if (!checked.ok) {
        sendJson(res, 400, { error: `字段 ${field} ${checked.error}` })
        return
      }
      clean[field] = checked.value
    }
    if (Object.keys(clean).length === 0) {
      sendJson(res, 400, { error: '没有要修改的字段' })
      return
    }

    try {
      await settings.update(config.ns, clean, revision)
    } catch (error) {
      if (error?.code === 'SETTINGS_CONFLICT') {
        sendJson(res, 409, {
          error: '配置已被其他窗口修改，请刷新后再改',
          expected: error.expected,
          actual: error.actual,
        })
        return
      }
      throw error
    }
    const updated = settings.describe().find((entry) => entry.ns === config.ns)
    sendJson(res, 200, updated === undefined ? { ns: config.ns, fields: [] } : describeParams(updated))
  }

  const PRESET_MODULE = '@deepseek-ai/dsh-agent-preset'
  // 只管理本包 cordis.patch.yml 里声明的 preset（preset-feishu / -power / -curator），
  // profile 里的 standard、ptc、minimal 等不属于本插件，不出现在面板。
  const PRESET_ENTRY_PREFIX = 'preset-feishu'

  function configEditorService() {
    const editor = ctx.get('configEditor')
    return editor !== undefined && typeof editor.edit === 'function' && typeof editor.entries === 'function'
      ? editor
      : undefined
  }

  function presetEntries(editor) {
    return editor.entries().filter(
      (entry) =>
        typeof entry.options.id === 'string' &&
        entry.options.id.startsWith(PRESET_ENTRY_PREFIX) &&
        entry.options.name === PRESET_MODULE &&
        entry.options.config !== null &&
        typeof entry.options.config === 'object' &&
        typeof entry.options.config.id === 'string',
    )
  }

  function presetSnapshot(entry, brokenById) {
    const config = entry.options.config
    return {
      id: config.id,
      name: config.name ?? config.id,
      description: config.description ?? '',
      order: config.order ?? null,
      active: entry.fiber?.state === 2,
      ...(brokenById.has(config.id) ? { broken: brokenById.get(config.id) } : {}),
      rows: describePlugins(config.plugins),
    }
  }

  async function presetBroken() {
    const registry = ctx.get('agentPresets')
    const brokenById = new Map()
    if (registry === undefined || typeof registry.list !== 'function') return brokenById
    try {
      for (const row of await registry.list()) {
        if (typeof row?.broken === 'string') brokenById.set(row.id, row.broken)
      }
    } catch {
      // 诊断读取失败不影响挂载列表本身
    }
    return brokenById
  }

  async function handleToolsRead(req, res) {
    const editor = configEditorService()
    if (editor === undefined) {
      sendJson(res, 503, { error: '当前 profile 没有 configEditor 服务' })
      return
    }
    const brokenById = await presetBroken()
    const presets = presetEntries(editor)
      .map((entry) => presetSnapshot(entry, brokenById))
      .sort((left, right) => (left.order ?? Infinity) - (right.order ?? Infinity) || left.id.localeCompare(right.id))
    sendJson(res, 200, { presets })
  }

  async function handleToolsWrite(req, res) {
    const editor = configEditorService()
    if (editor === undefined) {
      sendJson(res, 503, { error: '当前 profile 没有 configEditor 服务' })
      return
    }
    const body = await readJsonBody(req)
    const presetId = body?.preset
    const path = body?.path
    const disabled = body?.disabled
    if (typeof presetId !== 'string' || presetId === '') {
      sendJson(res, 400, { error: '缺少 preset id' })
      return
    }
    if (!validPath(path)) {
      sendJson(res, 400, { error: '工具行路径无效' })
      return
    }
    if (typeof disabled !== 'boolean') {
      sendJson(res, 400, { error: 'disabled 必须是布尔值' })
      return
    }
    const entry = presetEntries(editor).find((candidate) => candidate.options.config.id === presetId)
    if (entry === undefined) {
      sendJson(res, 404, { error: `找不到 preset ${presetId}` })
      return
    }
    try {
      await editor.edit(entry, (current) => ({
        ...current,
        plugins: setPluginDisabled(current?.plugins, path, disabled),
      }))
    } catch (error) {
      sendJson(res, 400, { error: `工具挂载未保存：${String(error?.message ?? error)}` })
      return
    }
    const brokenById = await presetBroken()
    const updated = presetEntries(editor).find((candidate) => candidate.options.config.id === presetId)
    sendJson(res, 200, {
      preset: updated === undefined ? undefined : presetSnapshot(updated, brokenById),
    })
  }

  async function handleAction(req, res) {
    const body = await readJsonBody(req)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
      return
    }
    if (body.kind === 'restart') {
      // 单元文件是 Restart=always，干净退出后由 systemd 拉起，不需要 sudo/systemctl。
      log.warn('feishu-panel: restart requested from panel')
      console.info('feishu-panel: restart requested from panel')
      sendJson(res, 200, { ok: true, restarting: true })
      setTimeout(() => process.exit(0), 500)
      return
    }
    const runtime = panelRuntime(res)
    if (runtime === undefined) return
    try {
      sendJson(res, 200, await runtime.action(body))
    } catch (error) {
      sendJson(res, 400, { error: String(error?.message ?? error) })
    }
  }

  function panelRuntime(res) {
    const runtime = getPanelRuntime()
    if (runtime === undefined) {
      sendJson(res, 503, { error: 'feishu-channel 插件当前未运行' })
      return undefined
    }
    return runtime
  }

  function settingsService() {
    const settings = ctx.get('settings')
    return settings !== undefined && typeof settings.describe === 'function' ? settings : undefined
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`请求体不是合法 JSON：${String(error)}`))
      }
    })
    req.on('error', reject)
  })
}
