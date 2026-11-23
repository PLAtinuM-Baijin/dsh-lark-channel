import assert from 'node:assert/strict'
import test from 'node:test'
import { outboundTarget } from '../src/outbound.js'

test('outboundTarget：默认直发，只有显式 reply 才引用', () => {
  assert.equal(outboundTarget({ replyTo: undefined, proactive: false, delivery: undefined }), undefined)
  assert.deepEqual(outboundTarget({ replyTo: 'om_1', proactive: false, delivery: undefined }), { replyTo: undefined })
  assert.deepEqual(outboundTarget({ replyTo: 'om_1', proactive: true, delivery: undefined }), { replyTo: undefined })
})

test('outboundTarget：delivery 覆盖当前轮', () => {
  assert.deepEqual(outboundTarget({ replyTo: 'om_1', proactive: false, delivery: { mode: 'direct' } }), {
    replyTo: undefined,
  })
  assert.deepEqual(outboundTarget({ replyTo: 'om_1', proactive: false, delivery: { mode: 'reply', replyTo: 'om_9' } }), {
    replyTo: 'om_9',
  })
  assert.deepEqual(outboundTarget({ replyTo: 'om_1', proactive: false, delivery: { mode: 'reply' } }), {
    replyTo: 'om_1',
  })
  assert.deepEqual(outboundTarget({ replyTo: undefined, proactive: false, delivery: { mode: 'reply' } }), {
    replyTo: undefined,
  })
})
