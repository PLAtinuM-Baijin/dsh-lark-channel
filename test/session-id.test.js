import assert from 'node:assert/strict'
import test from 'node:test'
import { isOwnerSessionId } from '../src/session-id.js'

test('isOwnerSessionId：只认主人私聊的每日会话 id', () => {
  const opts = { sessionPrefix: 'feishu-', ownerChatId: 'oc_owner' }
  assert.equal(isOwnerSessionId('feishu-oc_owner-20261121', opts), true)
  assert.equal(isOwnerSessionId('feishu-oc_owner-20261118', opts), true)
  assert.equal(isOwnerSessionId('feishu-oc_other-20261121', opts), false)
  assert.equal(isOwnerSessionId('feishu-oc_owner-2026-11-21', opts), false)
  assert.equal(isOwnerSessionId('feishu-oc_owner-20261121-extra', opts), false)
  assert.equal(isOwnerSessionId('session-f2f026d7', opts), false)
  assert.equal(isOwnerSessionId(undefined, opts), false)
  assert.equal(isOwnerSessionId('feishu-oc_owner-20261121', { sessionPrefix: 'feishu-', ownerChatId: '' }), false)
})
