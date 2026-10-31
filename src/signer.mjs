// signer.mjs —— 华为云 API 请求签名（SDK-HMAC-SHA256）
//
// 与 AWS SigV4 不同，华为云的 SDK-HMAC-SHA256 只有一次 HMAC，签名密钥就是 SK 本身：
//   CanonicalRequest =
//     HTTPMethod + "\n" +
//     CanonicalURI + "\n" +
//     CanonicalQueryString + "\n" +
//     CanonicalHeaders + "\n" +        ← 注意：头块本身已以 "\n" 结尾，这里再拼一个 ⇒ 出现空行
//     SignedHeaders + "\n" +
//     HexEncode(SHA256(RequestPayload))
//
//   StringToSign = "SDK-HMAC-SHA256" + "\n" + X-Sdk-Date + "\n" + HexEncode(SHA256(CanonicalRequest))
//   Signature    = HexEncode(HMAC-SHA256(SK, StringToSign))
//
//   Authorization = SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=<...>, Signature=<...>
//
// 三个容易踩的坑（本文件已处理）：
//   1. CanonicalURI 必须补尾部 "/"（"/v3/auth/domains" → "/v3/auth/domains/"）
//   2. CanonicalHeaders 末尾多一个换行，导致头块与 SignedHeaders 之间有空行
//   3. 参与签名的头必须小写、按字典序，且与实际发出的头完全一致

import { createHash, createHmac } from 'node:crypto'

export function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

export function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** 华为云的 URI 编码：除 -_.~ 与已保留字符外全部百分号编码 */
export function uriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

export function canonicalQueryString(query) {
  if (!query) return ''
  const params = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [uriEncode(k), uriEncode(String(v))])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return params.map(([k, v]) => `${k}=${v}`).join('&')
}

export function sdkDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    'T' +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z'
  )
}

/** 华为云规范化 URI：非根路径统一补尾部 "/"，与多段路径中间的 "/" 不做折叠 */
export function normalizeUri(uri) {
  const value = uri && uri.length > 0 ? uri : '/'
  if (value === '/') return '/'
  const withSlash = value.startsWith('/') ? value : `/${value}`
  return withSlash.endsWith('/') ? withSlash : `${withSlash}/`
}

/**
 * 生成签名头
 * @param {object} opts
 * @param {string} opts.ak        Access Key
 * @param {string} opts.sk        Secret Key
 * @param {string} opts.method    GET / POST ...
 * @param {string} opts.host      例: iam.cn-north-4.myhuaweicloud.com
 * @param {string} opts.uri       例: /v3.0/OS-CREDENTIAL/securitytokens  或 /
 * @param {object} [opts.query]   查询参数对象
 * @param {object} [opts.headers] 额外需要参与签名的头（如 content-type）
 * @param {string} [opts.body]    请求体（参与 payload hash）
 * @param {string} opts.region    例: cn-north-4
 * @param {string} opts.service   例: iam / ecs / obs
 * @param {Date}   [opts.date]    便于测试注入固定时间
 * @param {string} [opts.securityToken] 使用临时凭证时必填，会加到 x-security-token
 */
export function signRequest(opts) {
  const {
    ak,
    sk,
    method,
    host,
    uri = '/',
    query,
    headers = {},
    body = '',
    region,
    service,
    date = new Date(),
    securityToken,
  } = opts

  const xSdkDate = sdkDate(date)

  const signedHeaderMap = {
    host,
    'x-sdk-date': xSdkDate,
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])),
  }
  if (securityToken) signedHeaderMap['x-security-token'] = securityToken

  const headerNames = Object.keys(signedHeaderMap).sort()
  // 华为云的 CanonicalHeaders 块本身以换行结尾（与 SDK 源码一致），
  // 因此 canonicalRequest 中头块与 SignedHeaders 之间会出现一个空行
  const canonicalHeaders = headerNames.map((k) => `${k}:${signedHeaderMap[k].trim()}`).join('\n') + '\n'
  const signedHeaders = headerNames.join(';')

  const canonicalUri = normalizeUri(uri)

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body ?? ''),
  ].join('\n')

  const stringToSign = ['SDK-HMAC-SHA256', xSdkDate, sha256Hex(canonicalRequest)].join('\n')

  // 华为云 SDK-HMAC-SHA256 直接用 SK 对 stringToSign 做一次 HMAC，
  // 不存在 AWS 那种 date/region/service 四级派生（与官方 SDK 源码一致）
  const signature = createHmac('sha256', sk).update(stringToSign, 'utf8').digest('hex')

  const authorization = `SDK-HMAC-SHA256 Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const outHeaders = {
    Host: host,
    'X-Sdk-Date': xSdkDate,
    Authorization: authorization,
  }
  for (const [k, v] of Object.entries(headers)) outHeaders[k] = String(v)
  if (securityToken) outHeaders['X-Security-Token'] = securityToken

  return { headers: outHeaders, canonicalRequest, stringToSign, signature }
}
