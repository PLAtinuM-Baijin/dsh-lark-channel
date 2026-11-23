import assert from 'node:assert/strict'
import test from 'node:test'
import { parseInbound, renderMergedForward, summarizeInbound } from '../src/inbound.js'

const postContent = JSON.stringify({
  title: '标题',
  content: [
    [{ tag: 'text', text: '看这个' }, { tag: 'img', image_key: 'img_1' }, { tag: 'img', image_key: 'img_2' }],
  ],
})

test('parseInbound 文本：正文、引用与空消息判定', () => {
  assert.deepEqual(parseInbound({ message_type: 'text', content: '{"text":"你好"}', mentions: [] }), {
    kind: 'text',
    text: '你好',
  })
  assert.deepEqual(
    parseInbound({ message_type: 'text', content: '{"text":"你好"}', mentions: [], parent_id: 'om_parent' }),
    { kind: 'text', text: '你好', quoteId: 'om_parent' },
  )
  assert.equal(parseInbound({ message_type: 'text', content: '{"text":"  "}', mentions: [] }), null)
  assert.deepEqual(parseInbound({ message_type: 'text', content: '{"text":""}', mentions: [], parent_id: 'om_p' }), {
    kind: 'text',
    text: '',
    quoteId: 'om_p',
  })
})

test('parseInbound 富文本：文字、图片 key 与引用', () => {
  assert.deepEqual(
    parseInbound({ message_type: 'post', content: postContent, mentions: [], parent_id: 'om_q' }),
    { kind: 'post', text: '标题\n看这个[图片][图片]', imageKeys: ['img_1', 'img_2'], quoteId: 'om_q' },
  )
  assert.equal(parseInbound({ message_type: 'post', content: '{"content":[]}', mentions: [] }), null)
})

test('parseInbound 图片/文件/合并转发/未知类型', () => {
  assert.deepEqual(parseInbound({ message_type: 'image', content: '{"image_key":"img_1"}' }), {
    kind: 'image',
    fileKey: 'img_1',
  })
  assert.equal(parseInbound({ message_type: 'image', content: '{}' }), null)
  assert.deepEqual(parseInbound({ message_type: 'file', content: '{"file_key":"f_1","file_name":"a.txt"}' }), {
    kind: 'file',
    fileKey: 'f_1',
    fileName: 'a.txt',
  })
  assert.deepEqual(parseInbound({ message_type: 'merge_forward', content: 'Merged and Forwarded Message' }), {
    kind: 'merge_forward',
  })
  assert.equal(parseInbound({ message_type: 'sticker', content: '{}' }), null)
})

test('parseInbound 语音：有时长；缺 file_key 降级为 other 且保留引用', () => {
  const audio = parseInbound({ message_type: 'audio', content: '{"file_key":"f_a","duration":12300}' })
  assert.equal(audio.kind, 'audio')
  assert.equal(audio.fileKey, 'f_a')
  assert.equal(audio.durationSeconds, 12)
  assert.match(audio.notice, /约 12 秒/)
  const fallback = parseInbound({ message_type: 'audio', content: '{}', parent_id: 'om_p' })
  assert.equal(fallback.kind, 'other')
  assert.equal(fallback.quoteId, 'om_p')
  assert.match(fallback.text, /还不能收听或转写语音/)
})

test('parseInbound 视频：名称净化进说明，fileKey 缺失降级', () => {
  const media = parseInbound({ message_type: 'media', content: '{"file_key":"f_v","file_name":"../坏?名.mp4","duration":65000}' })
  assert.equal(media.kind, 'media')
  assert.equal(media.fileName, '../坏?名.mp4')
  assert.equal(media.durationSeconds, 65)
  assert.match(media.notice, /「坏_名.mp4」/)
  assert.equal(parseInbound({ message_type: 'media', content: '{"duration":1000}' }).kind, 'other')
})

test('summarizeInbound：截断、图片计数、引用前缀与各类占位', () => {
  assert.equal(summarizeInbound({ kind: 'text', text: 'x'.repeat(130) }), `${'x'.repeat(120)}…`)
  assert.equal(summarizeInbound({ kind: 'post', text: '看图', imageKeys: ['a', 'b'] }), '看图（含 2 张图片）')
  assert.equal(summarizeInbound({ kind: 'text', text: '你好', quoteId: 'om_1' }), '（引用了另一条消息）你好')
  assert.equal(summarizeInbound({ kind: 'file', fileName: '../a/b.txt' }), '文件「b.txt」')
  assert.equal(summarizeInbound({ kind: 'image' }), '一张图片')
  assert.equal(summarizeInbound({ kind: 'audio' }), '一条语音')
  assert.equal(summarizeInbound({ kind: 'media' }), '一个视频')
  assert.equal(summarizeInbound({ kind: 'merge_forward' }), '合并转发的聊天记录')
})

test('renderMergedForward：按父消息过滤子消息并编号', () => {
  const items = [
    { message_id: 'om_parent', msg_type: 'merge_forward' },
    {
      message_id: 'om_c1',
      upper_message_id: 'om_parent',
      msg_type: 'text',
      body: { content: '{"text":"第一句"}' },
      sender: { id: 'ou_a' },
    },
    {
      message_id: 'om_c2',
      upper_message_id: 'om_parent',
      msg_type: 'text',
      body: { content: '{"text":"第二句"}' },
      sender: { sender_type: 'app' },
    },
  ]
  assert.equal(
    renderMergedForward(items, 'om_parent'),
    '[合并转发的聊天记录，共 2 条]\n1. (ou_a) 第一句\n2. (机器人) 第二句',
  )
})

test('renderMergedForward：无子消息时退回父消息以外的列表', () => {
  const items = [
    { message_id: 'om_parent', msg_type: 'merge_forward' },
    {
      message_id: 'om_c1',
      msg_type: 'text',
      body: { content: '{"text":"孤儿消息"}' },
      sender: { id: 'ou_a' },
    },
  ]
  assert.equal(renderMergedForward(items, 'om_parent'), '[合并转发的聊天记录，共 1 条]\n1. (ou_a) 孤儿消息')
  assert.match(
    renderMergedForward([{ message_id: 'om_parent', msg_type: 'merge_forward' }], 'om_parent'),
    /读不到任何消息/,
  )
})

test('renderMergedForward：单条过长带截断标记', () => {
  const long = 'y'.repeat(2100)
  const items = [
    { message_id: 'om_parent', msg_type: 'merge_forward' },
    {
      message_id: 'om_c1',
      upper_message_id: 'om_parent',
      msg_type: 'text',
      body: { content: JSON.stringify({ text: long }) },
      sender: { id: 'ou_a' },
    },
  ]
  const rendered = renderMergedForward(items, 'om_parent')
  assert.match(rendered, /…（过长，已截断）/)
  assert.ok(!rendered.includes(long))
})
