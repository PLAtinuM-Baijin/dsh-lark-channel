import assert from 'node:assert/strict'
import test from 'node:test'
import { HISTORY_DIR, QUOTE_TEXT_LIMIT } from '../src/constants.js'
import { cardText, historyTextOfInbound, messageItemText, parseJson, parsePost, parseText } from '../src/message-format.js'
import {
  checkLark,
  describeLarkError,
  errorText,
  historyName,
  imageMediaType,
  isTextFile,
  safeFileName,
  streamToBuffer,
} from '../src/lark-utils.js'
import { clip, shorten, split } from '../src/text-utils.js'

test('parseText 还原 @ 并 trim', () => {
  assert.equal(parseText('{"text":"你好 @_user_1 晚安"}', [{ key: '@_user_1', name: '@张三' }]), '你好 @张三 晚安')
  assert.equal(parseText('not json'), '')
})

test('parsePost 拼行、还原 @、收集图片', () => {
  const content = JSON.stringify({
    title: '标题',
    content: [
      [{ tag: 'text', text: '第一行' }, { tag: 'at', user_name: '李四' }],
      [{ tag: 'img', image_key: 'img_1' }, { tag: 'media' }, { tag: 'emotion', emoji_type: 'SMILE' }],
    ],
  })
  assert.deepEqual(parsePost(content, []), {
    text: '标题\n第一行@李四\n[图片][视频][表情]',
    imageKeys: ['img_1'],
  })
  assert.deepEqual(parsePost('bad json', []), { text: '', imageKeys: [] })
})

test('parseJson 只接受对象，坏内容返回 undefined', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 })
  assert.equal(parseJson('[1]')?.length, 1)
  assert.equal(parseJson('42'), undefined)
  assert.equal(parseJson('null'), undefined)
  assert.equal(parseJson('oops'), undefined)
})

test('cardText 兼容接收结构与 DSL 1.0/2.0', () => {
  assert.equal(
    cardText({
      title: '卡片标题',
      elements: [
        [{ tag: 'text', text: '第一段' }],
        [{ tag: 'button', text: '主按钮' }, { tag: 'a', text: '飞书' }],
        [{ tag: 'img', image_key: 'img_x' }],
      ],
    }),
    '卡片标题\n第一段\n主按钮\n飞书\n[图片]',
  )
  assert.equal(
    cardText({
      header: { title: { tag: 'plain_text', content: '审批通知' } },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: '**张三** 提交了申请' } },
        { tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: '通过' } }] },
        { tag: 'note', elements: [{ tag: 'plain_text', content: '请尽快处理' }] },
      ],
    }),
    '审批通知\n**张三** 提交了申请\n通过\n请尽快处理',
  )
  assert.equal(
    cardText({
      schema: '2.0',
      body: { elements: [{ tag: 'markdown', content: '本周完成 3 项' }, { tag: 'button', text: '详情' }] },
    }),
    '本周完成 3 项\n详情',
  )
  assert.equal(cardText({ type: 'template', data: { template_id: 'ctp_x' } }), '')
  const cyclic = { title: '环' }
  cyclic.self = cyclic
  assert.equal(cardText(cyclic), '环')
})

test('messageItemText 渲染各类消息', () => {
  const text = messageItemText({ msg_type: 'text', body: { content: '{"text":"你好"}' } })
  assert.deepEqual(text, { text: '你好', imageKeys: [] })
  const file = messageItemText({ msg_type: 'file', body: { content: '{"file_name":"../a/b.txt"}' } })
  assert.equal(file.text, '[文件「b.txt」]')
  const unknown = messageItemText({ msg_type: 'system', body: { content: '{}' } })
  assert.equal(unknown.text, '[system消息]')
  const emptyCard = messageItemText({ msg_type: 'interactive', body: { content: '{"type":"template"}' } })
  assert.equal(emptyCard.text, '[卡片消息（没有可读文本）]')
  const card = messageItemText({
    msg_type: 'interactive',
    body: { content: JSON.stringify({ schema: '2.0', body: { elements: [{ tag: 'markdown', content: '正文' }] } }) },
  })
  assert.equal(card.text, '[卡片消息]\n正文')
  const longCard = messageItemText({
    msg_type: 'interactive',
    body: { content: JSON.stringify({ schema: '2.0', body: { elements: [{ tag: 'markdown', content: 'x'.repeat(QUOTE_TEXT_LIMIT + 10) }] } }) },
  })
  assert.ok(longCard.text.endsWith('…（过长，已截断）'))
})

test('historyTextOfInbound 摘要', () => {
  assert.equal(historyTextOfInbound({ kind: 'text', text: '你好' }), '你好')
  assert.equal(historyTextOfInbound({ kind: 'text', text: '你好', quoteId: 'om_1' }), '[引用一条消息] 你好')
  assert.equal(historyTextOfInbound({ kind: 'merge_forward' }), '[合并转发聊天记录]')
  assert.equal(historyTextOfInbound({ kind: 'file', fileName: 'a/b.pdf' }), '[文件] b.pdf')
})

test('safeFileName 去路径、去前导点、保留中文', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd')
  assert.equal(safeFileName('..隐藏.txt'), '隐藏.txt')
  assert.equal(safeFileName('a b*c?.md'), 'a_b_c_.md')
  assert.equal(safeFileName(''), '')
  assert.equal(safeFileName(undefined), '')
})

test('historyName 生成归档名', () => {
  assert.equal(historyName('om_1', 0, 'a.txt'), 'om_1-0-a.txt')
  assert.equal(historyName('om_1', 1, '', 'image/png'), 'om_1-1.png')
  assert.equal(historyName('om_1', 2, ''), 'om_1-2.bin')
})

test('imageMediaType 认 MIME、后缀和文件头', () => {
  assert.equal(imageMediaType('image/webp', Buffer.alloc(0)), 'image/webp')
  assert.equal(imageMediaType('application/octet-stream', Buffer.alloc(0), 'x.GIF'), 'image/gif')
  assert.equal(imageMediaType('', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/png')
  assert.equal(imageMediaType('', Buffer.from('hello')), undefined)
})

test('isTextFile 看 MIME 与后缀', () => {
  assert.equal(isTextFile('a.unknownext', 'text/plain'), true)
  assert.equal(isTextFile('a.MD', 'application/octet-stream'), true)
  assert.equal(isTextFile('a.bin', 'application/octet-stream'), false)
})

test('shorten / clip / split', () => {
  assert.equal(shorten('abc', 5), 'abc')
  assert.equal(shorten('abcdef', 3), 'abc…')
  assert.equal(clip('abc', 5), 'abc')
  assert.equal(clip('abcdef', 3), 'abc…（过长，已截断）')
  assert.deepEqual(split('ab😀cd', 2), ['ab', '😀c', 'd'])
  assert.deepEqual(split('', 2), [''])
})

test('checkLark 把业务错误转成异常', () => {
  assert.equal(checkLark({ code: 0, data: 1 }).data, 1)
  assert.equal(checkLark({ data: 1 }).data, 1)
  assert.throws(() => checkLark({ code: 230013, msg: 'no perm' }), /Lark API 230013: no perm/)
})

test('describeLarkError / errorText', async () => {
  assert.equal(await describeLarkError({ response: { status: 400, data: { code: 1, msg: 'bad' } } }), '飞书 API 400：1 bad')
  assert.equal(await describeLarkError({ response: { status: 502, data: 'gateway' } }), 'HTTP 502: gateway')
  assert.equal(await describeLarkError(new Error('boom')), 'boom')
  assert.equal(errorText('plain'), 'plain')
})

test('streamToBuffer 超限中断', async () => {
  async function* small() {
    yield Buffer.from('ab')
    yield 'cd'
  }
  assert.equal((await streamToBuffer(small(), 10)).toString(), 'abcd')
  async function* big() {
    yield Buffer.alloc(8)
    yield Buffer.alloc(8)
  }
  await assert.rejects(() => streamToBuffer(big(), 10), /exceeds 10 bytes/)
})

test('HISTORY_DIR 指向归档目录', () => {
  assert.match(HISTORY_DIR, /feishu-history[\\/]files$/)
})
