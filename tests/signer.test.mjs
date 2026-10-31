#!/usr/bin/env node
// tests/signer.test.mjs —— 签名实现的确定性单测（固定时间 + 固定密钥，结果可复现）
import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalQueryString, sdkDate, sha256Hex, signRequest, uriEncode } from '../src/signer.mjs'

const FIXED = new Date('2026-10-31T02:00:00Z')

test('sdkDate 生成 UTC 紧凑格式', () => {
  assert.equal(sdkDate(FIXED), '20261031T020000Z')
})

test('uriEncode 保留 -_.~ 并转义特殊字符', () => {
  assert.equal(uriEncode('a-b_c.d~e'), 'a-b_c.d~e')
  assert.equal(uriEncode('a b'), 'a%20b')
  assert.equal(uriEncode('a/b'), 'a%2Fb')
})

test('canonicalQueryString 按 key 排序并编码', () => {
  assert.equal(canonicalQueryString({ b: '2', a: '1', c: 'x y' }), 'a=1&b=2&c=x%20y')
  assert.equal(canonicalQueryString(undefined), '')
  assert.equal(canonicalQueryString({ a: null, b: 1 }), 'b=1')
})

test('sha256Hex 对空串有固定值', () => {
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

test('signRequest 产出确定性的 Authorization（固定时间同一输入结果一致）', () => {
  const params = {
    ak: 'AKIDEXAMPLE',
    sk: 'SECRETEXAMPLE',
    method: 'GET',
    host: 'iam.cn-north-4.myhuaweicloud.com',
    uri: '/v3.0/OS-CREDENTIAL/domains',
    query: {},
    region: 'cn-north-4',
    service: 'iam',
    date: FIXED,
  }
  const a = signRequest(params)
  const b = signRequest(params)
  assert.equal(a.signature, b.signature)
  assert.match(a.headers.Authorization, /^SDK-HMAC-SHA256 Access=AKIDEXAMPLE, SignedHeaders=host;x-sdk-date, Signature=[0-9a-f]{64}$/)
  assert.equal(a.headers['X-Sdk-Date'], '20261031T020000Z')
})

test('canonicalRequest 结构符合规范（方法/URI/查询/头块/签名头/payloadhash）', () => {
  const { canonicalRequest } = signRequest({
    ak: 'AK',
    sk: 'SK',
    method: 'post',
    host: 'ecs.cn-north-4.myhuaweicloud.com',
    uri: '/v2.1/servers/detail',
    query: { limit: 1 },
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
    region: 'cn-north-4',
    service: 'ecs',
    date: FIXED,
  })
  // 头块以 "\n" 结尾，因此头块与 SignedHeaders 之间存在一个空行
  const expected = [
    'POST',
    '/v2.1/servers/detail/',
    'limit=1',
    'content-type:application/json',
    'host:ecs.cn-north-4.myhuaweicloud.com',
    'x-sdk-date:20261031T020000Z',
    '',
    'content-type;host;x-sdk-date',
    sha256Hex('{"a":1}'),
  ].join('\n')
  assert.equal(canonicalRequest, expected)
})

test('签名只依赖 SK 与 stringToSign（同 CR 换 region/service 不改变签名）', () => {
  const base = {
    ak: 'AK',
    sk: 'SK',
    method: 'GET',
    host: 'h',
    uri: '/',
    date: FIXED,
  }
  const s1 = signRequest({ ...base, region: 'cn-north-4', service: 'iam' }).signature
  const s2 = signRequest({ ...base, region: 'cn-east-3', service: 'ecs' }).signature
  assert.equal(s1, s2, '华为云 SDK-HMAC-SHA256 不做 region/service 密钥派生')
})

test('安全令牌参与签名并出现在请求头', () => {
  const { headers, canonicalRequest } = signRequest({
    ak: 'AK',
    sk: 'SK',
    method: 'GET',
    host: 'iam.cn-north-4.myhuaweicloud.com',
    uri: '/',
    region: 'cn-north-4',
    service: 'iam',
    securityToken: 'TOKEN123',
    date: FIXED,
  })
  assert.ok(canonicalRequest.includes('x-security-token:TOKEN123'))
  assert.equal(headers['X-Security-Token'], 'TOKEN123')
})

