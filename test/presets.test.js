import assert from 'node:assert/strict'
import test from 'node:test'
import { describePlugins, setPluginDisabled, validPath } from '../ui/presets.js'

test('describePlugins：路径、分组、条件与禁用状态', () => {
  const rows = [
    { id: 'a', name: 'mod-a' },
    { id: 'b', name: 'mod-b', disabled: true },
    {
      id: 'g',
      name: 'cordis:group',
      group: true,
      config: [{ id: 'c', name: 'mod-c', disabled: { __jsExpr: 'process.platform === "win32"' } }],
    },
  ]
  const out = describePlugins(rows)
  assert.equal(out.length, 3)
  assert.deepEqual(out[0].path, [0])
  assert.equal(out[0].group, false)
  assert.equal(out[0].disabled, false)
  assert.equal(out[1].disabled, true)
  const group = out[2]
  assert.equal(group.group, true)
  assert.deepEqual(group.children[0].path, [2, 0])
  assert.equal(group.children[0].condition, 'process.platform === "win32"')
  assert.equal(group.children[0].disabled, undefined)
})

test('describePlugins：忽略非法的行并容忍空输入', () => {
  assert.deepEqual(describePlugins(undefined), [])
  const out = describePlugins([null, 3, 'x', { id: 'ok', name: 'mod' }])
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].path, [3])
})

test('setPluginDisabled：不修改输入，启用时删除 disabled', () => {
  const rows = [
    { id: 'a', name: 'mod-a' },
    { id: 'g', name: 'cordis:group', group: true, config: [{ id: 'c', name: 'mod-c', disabled: false }] },
  ]
  const off = setPluginDisabled(rows, [1, 0], true)
  assert.equal(off[1].config[0].disabled, true)
  assert.equal(rows[1].config[0].disabled, false)
  const on = setPluginDisabled(off, [1, 0], false)
  assert.equal('disabled' in on[1].config[0], false)
  const top = setPluginDisabled(rows, [0], true)
  assert.equal(top[0].disabled, true)
  assert.equal(rows[0].disabled, undefined)
})

test('setPluginDisabled：保留表达式与其他行', () => {
  const rows = [
    { id: 'a', name: 'mod-a', config: { dir: { __jsExpr: 'process.env.DIR' } } },
    { id: 'b', name: 'mod-b', disabled: { __jsExpr: 'x' } },
  ]
  const next = setPluginDisabled(rows, [0], true)
  assert.deepEqual(next[0].config.dir, { __jsExpr: 'process.env.DIR' })
  assert.deepEqual(next[1].disabled, { __jsExpr: 'x' })
})

test('setPluginDisabled：拒绝无效路径', () => {
  assert.equal(validPath([]), false)
  assert.equal(validPath([1.2]), false)
  assert.equal(validPath(['0']), false)
  assert.equal(validPath([0]), true)
  assert.throws(() => setPluginDisabled([{ id: 'a' }], [3], true), /路径无效/)
  assert.throws(() => setPluginDisabled([{ id: 'a' }], [0, 0], true), /路径无效/)
  assert.throws(() => setPluginDisabled([{ group: true, config: {} }], [0, 0], true), /路径无效/)
})
