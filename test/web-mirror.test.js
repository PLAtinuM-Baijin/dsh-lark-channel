import assert from 'node:assert/strict'
import test from 'node:test'
import { clipQuestion, createWebMirror, webQuestionText } from '../src/web-mirror.js'

test('webQuestionText：文本拼接，附件留占位符', () => {
  assert.equal(webQuestionText('  hi  '), 'hi')
  assert.equal(webQuestionText([{ type: 'text', text: '看这个' }, { type: 'image' }]), '看这个\n[图片]')
  assert.equal(webQuestionText([{ type: 'file' }, { type: 'text', text: '附件' }]), '[文件]\n附件')
  assert.equal(webQuestionText(undefined), '')
})

test('clipQuestion：按码点截断', () => {
  const text = '好'.repeat(4001)
  const clipped = clipQuestion(text)
  assert.equal(Array.from(clipped).length, 4001)
  assert.ok(clipped.endsWith('…'))
  assert.equal(clipQuestion('短句'), '短句')
})

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeMirror(sent, overrides = {}) {
  return createWebMirror({
    config: {
      syncWebToFeishu: { get: () => true },
      ownerChatId: 'oc_owner',
      ...overrides.config,
    },
    log: { warn: () => undefined },
    sendChatText: async (chatId, text) => {
      sent.push({ chatId, text })
    },
    assistantText: (event) =>
      event.data.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    isOwnerSession: overrides.isOwnerSession ?? (() => true),
  })
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

test('onClaimed：channel 自己的消息不镜像，网页消息加前缀', async () => {
  const sent = []
  const mirror = makeMirror(sent)
  const idle = deferred()
  const agent = { whenIdle: () => idle.promise }
  const state = { sessionId: 's', chatId: 'oc_owner', chatType: 'p2p', driving: false, delivered: new Set() }

  mirror.onClaimed(state, { id: 'm0', source: { kind: 'user' }, content: [{ type: 'text', text: '飞书消息' }] }, agent)
  mirror.onClaimed(state, { id: 'm1', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: '网页问题' }] }, agent)
  await flush()

  assert.deepEqual(sent, [{ chatId: 'oc_owner', text: '[user asked from web] 网页问题' }])
  idle.resolve()
})

test('syncWebToFeishu 关闭时不镜像', async () => {
  const sent = []
  const mirror = makeMirror(sent, { config: { syncWebToFeishu: { get: () => false } } })
  const agent = { whenIdle: () => Promise.resolve() }
  const state = { sessionId: 's', chatId: 'oc_owner', chatType: 'p2p', driving: false, delivered: new Set(), agent }

  mirror.onClaimed(state, { id: 'm1', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'q' }] }, agent)
  await flush()

  assert.equal(sent.length, 0)
})

test('onClaimed：同一个网页消息重复领取只发一次问题', async () => {
  const sent = []
  const mirror = makeMirror(sent)
  const idle = deferred()
  const agent = { whenIdle: () => idle.promise }
  const state = { sessionId: 's', chatId: 'oc_owner', chatType: 'p2p', driving: false, delivered: new Set() }
  const message = { id: 'm1', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'q' }] }

  mirror.onClaimed(state, message, agent)
  mirror.onClaimed(state, message, agent)
  await flush()

  assert.equal(sent.length, 1)
  idle.resolve()
})

test('onAssistantEnd：网页轮次转发助手文本；channel 驱动或已发送时跳过', async () => {
  const sent = []
  const mirror = makeMirror(sent)
  const idle = deferred()
  const event = { type: 'assistant/message', seq: 5, data: { message: { content: [{ type: 'text', text: '答案' }] } } }
  const agent = {
    whenIdle: () => idle.promise,
    session: { snapshotEvents: (from, to) => (from === 5 && to === 6 ? [event] : []) },
  }
  const state = { sessionId: 's', chatId: 'oc_owner', chatType: 'p2p', driving: false, delivered: new Set(), agent }
  const frame = { outcome: { kind: 'committed', eventType: 'assistant/message', seq: 5 } }

  // 没有网页活动时不转发
  mirror.onAssistantEnd(state, frame)
  await flush()
  assert.equal(sent.length, 0)

  mirror.onClaimed(state, { id: 'm1', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'q' }] }, agent)
  await flush()
  sent.length = 0

  // channel 正在驱动这一轮时不重复发
  state.driving = true
  mirror.onAssistantEnd(state, frame)
  await flush()
  assert.equal(sent.length, 0)

  state.driving = false
  mirror.onAssistantEnd(state, frame)
  await flush()
  assert.deepEqual(sent, [{ chatId: 'oc_owner', text: '答案' }])
  assert.ok(state.delivered.has(5))

  // 同一 seq 不重复
  mirror.onAssistantEnd(state, frame)
  await flush()
  assert.equal(sent.length, 1)
  idle.resolve()
})
