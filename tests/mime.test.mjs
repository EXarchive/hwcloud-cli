#!/usr/bin/env node
// tests/mime.test.mjs —— 邮件构造与模板渲染单测
import test from 'node:test'
import assert from 'node:assert/strict'
import { addressList, encodeHeaderValue, foldHeader, wrap76 } from '../scripts/mime.mjs'
import { buildMessage } from '../scripts/mime.mjs'
import { renderTemplate } from '../scripts/send-mail.mjs'

test('encodeHeaderValue 纯 ASCII 原样返回', () => {
  assert.equal(encodeHeaderValue('Weekly Report'), 'Weekly Report')
})

test('encodeHeaderValue 中文按 RFC2047 Base64 编码', () => {
  const v = encodeHeaderValue('周报')
  assert.match(v, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
  const b64 = v.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '')
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), '周报')
})

test('addressList 支持带名字与逗号分隔', () => {
  assert.equal(addressList('a@b.com'), 'a@b.com')
  assert.equal(addressList(['张 三 <z@b.com>', 'c@d.com']), `${encodeHeaderValue('张 三')} <z@b.com>, c@d.com`)
})

test('foldHeader 折行不超过限制', () => {
  const long = 'a'.repeat(40) + ' ' + 'b'.repeat(40)
  const folded = foldHeader('Subject', long, 50)
  for (const line of folded.split('\r\n')) assert.ok(line.length <= 60)
})

test('wrap76 每行不超过 76 字符', () => {
  const b64 = 'A'.repeat(200)
  for (const line of wrap76(b64).split('\r\n')) assert.ok(line.length <= 76)
})

test('buildMessage 生成 multipart/alternative 双正文', () => {
  const msg = buildMessage({
    from: 'me@example.com',
    to: 'you@example.com',
    subject: '测试',
    text: '纯文本正文',
    html: '<p>HTML 正文</p>',
    date: new Date('2026-10-31T02:00:00Z'),
    messageId: 'fixed@local',
  })
  assert.ok(msg.includes('MIME-Version: 1.0'))
  assert.ok(msg.includes('multipart/alternative'))
  assert.ok(msg.includes('Content-Type: text/plain; charset=UTF-8'))
  assert.ok(msg.includes('Content-Type: text/html; charset=UTF-8'))
  assert.ok(msg.includes('Message-ID: <fixed@local>'))
  // base64 编码后的中文正文应能解回
  const b64s = [...msg.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)].map((m) =>
    m[1].replace(/\r\n/g, ''),
  )
  const decoded = b64s.map((b) => Buffer.from(b, 'base64').toString('utf8'))
  assert.ok(decoded.some((d) => d.includes('纯文本正文')))
  assert.ok(decoded.some((d) => d.includes('HTML 正文')))
})

test('buildMessage 有附件时切 multipart/mixed', () => {
  const msg = buildMessage({
    from: 'me@example.com',
    to: 'you@example.com',
    subject: 'with attachment',
    text: 'body',
    attachments: [{ filename: 'a.txt', content: 'hello' }],
  })
  assert.ok(msg.includes('multipart/mixed'))
  assert.ok(msg.includes('Content-Disposition: attachment'))
})

test('renderTemplate 替换占位并在缺失时报告', () => {
  const { out, missing } = renderTemplate('<p>{{title}} / {{name}}</p>', { title: '周报' })
  assert.equal(out, '<p>周报 / {{name}}</p>')
  assert.deepEqual(missing, ['name'])
})

test('renderTemplate 无缺失时 missing 为空', () => {
  const { out, missing } = renderTemplate('{{a}}-{{b}}', { a: 1, b: 2 })
  assert.equal(out, '1-2')
  assert.equal(missing.length, 0)
})
