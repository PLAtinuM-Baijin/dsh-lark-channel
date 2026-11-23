import assert from 'node:assert/strict'
import test from 'node:test'
import { checkParamValue, describeParams, normalizeBase } from '../ui/params.js'

/** 与 settings.describe 返回的 volatile form（schemastery toJSON）同构的样例。 */
function sampleRow() {
  return {
    ns: 'feishu-channel',
    revision: 7,
    schema: {
      uid: 1,
      refs: {
        1: {
          type: 'object',
          meta: {},
          dict: { cardStreaming: 2, replyTimeoutMs: 3, allowedChatIds: 4 },
        },
        2: { type: 'boolean', meta: { default: true, description: '流式卡片' } },
        3: { type: 'number', meta: { default: 180000 } },
        4: { type: 'array', meta: { default: [] }, inner: 5 },
        5: { type: 'string', meta: {} },
      },
    },
    value: { cardStreaming: false, replyTimeoutMs: 90000, allowedChatIds: ['oc_one'] },
  }
}

test('describeParams：只列 volatile 字段并带上当前值与类型', () => {
  const out = describeParams(sampleRow())
  assert.equal(out.ns, 'feishu-channel')
  assert.equal(out.revision, 7)
  assert.deepEqual(
    out.fields.map((field) => field.name),
    ['cardStreaming', 'replyTimeoutMs', 'allowedChatIds'],
  )
  const card = out.fields.find((field) => field.name === 'cardStreaming')
  assert.equal(card.type, 'boolean')
  assert.equal(card.value, false)
  assert.equal(card.default, true)
  assert.equal(card.description, '流式卡片')
  const ids = out.fields.find((field) => field.name === 'allowedChatIds')
  assert.equal(ids.type, 'array')
  assert.equal(ids.itemType, 'string')
  assert.deepEqual(ids.value, ['oc_one'])
})

test('describeParams：schema 缺失时返回空字段而不是抛错', () => {
  assert.deepEqual(describeParams({ ns: 'x', revision: 0 }).fields, [])
  assert.deepEqual(describeParams(undefined).fields, [])
})

test('checkParamValue：类型校验与数组清洗', () => {
  assert.deepEqual(checkParamValue({ type: 'boolean' }, true), { ok: true, value: true })
  assert.equal(checkParamValue({ type: 'boolean' }, 'true').ok, false)
  assert.deepEqual(checkParamValue({ type: 'number' }, 123), { ok: true, value: 123 })
  assert.equal(checkParamValue({ type: 'number' }, Number.NaN).ok, false)
  assert.equal(checkParamValue({ type: 'string' }, 1).ok, false)
  assert.deepEqual(checkParamValue({ type: 'array', itemType: 'string' }, [' oc_a ', '', 'oc_b']), {
    ok: true,
    value: ['oc_a', 'oc_b'],
  })
  assert.equal(checkParamValue({ type: 'array', itemType: 'string' }, [1]).ok, false)
  assert.deepEqual(checkParamValue({ type: 'array', itemType: 'number' }, [1, 2]), { ok: true, value: [1, 2] })
  assert.equal(checkParamValue({ type: 'array', itemType: 'number' }, ['1']).ok, false)
})

test('normalizeBase：补前导斜杠、去掉尾部斜杠', () => {
  assert.equal(normalizeBase('/feishu-panel'), '/feishu-panel')
  assert.equal(normalizeBase('feishu-panel/'), '/feishu-panel')
  assert.equal(normalizeBase(''), '/feishu-panel')
  assert.equal(normalizeBase(undefined), '/feishu-panel')
})

test('client bundle：注册侧栏图标与 keyed main 页面', async () => {
  let captured
  globalThis.window = {
    __ModuleLoader__: {
      load: (definition) => {
        captured = definition
      },
    },
  }
  try {
    await import(new URL('../ui/client.js', import.meta.url).href)
  } finally {
    delete globalThis.window
  }

  assert.equal(captured.id, '@local/dsh-feishu-panel')
  const exports = captured.factory((spec) => {
    assert.equal(spec, 'react')
    return {
      createElement: () => null,
      useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
      useEffect: () => undefined,
      useRef: () => ({ current: undefined }),
      useMemo: (factory) => factory(),
      useCallback: (fn) => fn,
    }
  })
  assert.deepEqual(exports.inject, ['slots'])

  const registrations = []
  const slots = {
    inject: (name, callback) => {
      assert.ok(['sidebar.panellist', 'main'].includes(name), `unexpected slot ${name}`)
      callback()
    },
    register: (options, component) => {
      registrations.push({ options, component })
      return () => undefined
    },
  }
  exports.apply({ slots })

  assert.equal(registrations.length, 2)
  const sidebar = registrations.find((entry) => entry.options.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.options.name === 'main')
  assert.equal(sidebar.options.id, 'feishu')
  assert.equal(sidebar.options.label, '飞书')
  assert.equal(sidebar.options.order, 20)
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(main.options.key, 'feishu')
  assert.equal(typeof main.component, 'function')
})
