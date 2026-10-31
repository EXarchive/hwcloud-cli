// client.mjs —— 带签名的华为云 API 调用封装
import { signRequest } from './signer.mjs'

export const DEFAULT_REGION = 'cn-north-4'

// 各服务在华为云上的 endpoint 规则：{service}.{region}.myhuaweicloud.com
export function endpointFor(service, region = DEFAULT_REGION) {
  return `${service}.${region}.myhuaweicloud.com`
}

export function loadCreds(env = process.env) {
  const ak = env.HUAWEICLOUD_SDK_AK || env.HUAWEICLOUD_AK || env.HW_ACCESS_KEY
  const sk = env.HUAWEICLOUD_SDK_SK || env.HUAWEICLOUD_SK || env.HW_SECRET_KEY
  const securityToken = env.HUAWEICLOUD_SDK_SECURITY_TOKEN || env.HW_SECURITY_TOKEN
  const projectId = env.HUAWEICLOUD_PROJECT_ID || ''
  return { ak, sk, securityToken, projectId }
}

/**
 * 发起一次已签名的华为云 REST 调用
 * @returns {Promise<{status:number, ok:boolean, json:any, text:string}>}
 */
export async function callApi({
  service,
  method = 'GET',
  path = '/',
  query,
  body,
  region = DEFAULT_REGION,
  creds,
  extraHeaders = {},
}) {
  const { ak, sk, securityToken } = creds ?? loadCreds()
  if (!ak || !sk) {
    throw new Error('缺少凭证：请设置 HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK')
  }
  const host = endpointFor(service, region)
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)

  const headers = { ...extraHeaders }
  if (payload) headers['content-type'] = 'application/json'

  const signed = signRequest({
    ak,
    sk,
    method,
    host,
    uri: path,
    query,
    headers,
    body: payload,
    region,
    service,
    securityToken,
  })

  const url = new URL(`https://${host}${path}`)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }

  const res = await fetch(url, {
    method,
    headers: signed.headers,
    body: payload ? payload : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, ok: res.ok, json, text }
}
