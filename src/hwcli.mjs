#!/usr/bin/env node
// hwcli.mjs —— 把华为云服务封装成命令行工具
//
// 用法:
//   node src/hwcli.mjs whoami                        # 用 AK/SK 换账号身份（IAM 临时凭证接口）
//   node src/hwcli.mjs iam:domains                   # 列出账号可用的 IAM domains
//   node src/hwcli.mjs ecs:servers [--region r]      # 列出 ECS 云服务器
//   node src/hwcli.mjs regions                       # 列出所有区域（IAM）
//   node src/hwcli.mjs raw --service iam --path /v3.0/OS-CREDENTIAL/securitytokens --method POST
//
// 全局参数: --region <region>  --json  --quiet
// 凭证: 环境变量 HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK（可选 SECURITY_TOKEN）

import { callApi, DEFAULT_REGION, loadCreds } from './client.mjs'

const argv = process.argv.slice(2)

function takeFlag(name) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const value = argv[i + 1]
  if (!value || value.startsWith('--')) return true
  argv.splice(i, 2)
  return value
}

const region = takeFlag('region') || process.env.HUAWEICLOUD_REGION || DEFAULT_REGION
const asJson = takeFlag('json') === true
const quiet = takeFlag('quiet') === true
const command = argv.shift() || 'help'

function print(data, humanFormatter) {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  if (humanFormatter) humanFormatter(data)
  else console.log(JSON.stringify(data, null, 2))
}

function fail(message, code = 1) {
  console.error(`❌ ${message}`)
  process.exit(code)
}

function requireJson(res, stage) {
  if (!res.ok || !res.json) {
    const detail = res.json ? JSON.stringify(res.json).slice(0, 400) : res.text.slice(0, 400)
    fail(`${stage} 失败 [HTTP ${res.status}] ${detail}`)
  }
  return res.json
}

const help = `hwcli —— 华为云服务命令行封装

命令:
  whoami                     用 AK/SK 创建临时凭证，确认调用身份
  iam:domains                列出账号可访问的 IAM domains（验证签名是否正确）
  ecs:servers                列出 ECS 云服务器（按 region）
  regions                    列出可用区域
  raw --service <s> --path <p> [--method M]   直接调任意接口

全局参数:
  --region <region>   默认 ${DEFAULT_REGION}（或环境变量 HUAWEICLOUD_REGION）
  --json              输出原始 JSON
  --quiet             只输出关键结果

示例:
  $env:HUAWEICLOUD_SDK_AK="..."; $env:HUAWEICLOUD_SDK_SK="..."
  node src/hwcli.mjs whoami --json
  node src/hwcli.mjs ecs:servers --region cn-north-4
`

async function cmdWhoami() {
  const creds = loadCreds()
  if (!creds.ak || !creds.sk) fail('缺少凭证：请设置 HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK')
  // /v3/auth/domains 是验证 AK/SK 签名链路的标准入口：能返回 domain 即签名与凭证都正确
  const res = await callApi({
    service: 'iam',
    method: 'GET',
    path: '/v3/auth/domains',
    region,
    creds,
    extraHeaders: creds.projectId ? {} : {},
  })
  if (res.status === 401) fail(`签名被拒 [401] ${res.text.slice(0, 300)}`)
  const data = requireJson(res, 'whoami')
  const domains = data.domains ?? []
  const first = domains[0] ?? {}
  print(
    { ak: mask(creds.ak), region, domainId: first.id, domainName: first.name, signatureAccepted: true },
    (d) => {
      console.log(`AK           : ${d.ak}`)
      console.log(`区域         : ${d.region}`)
      console.log(`账号 Domain  : ${d.domainName}  (${d.domainId})`)
      console.log(`签名校验     : 通过`)
    },
  )
}

async function cmdDomains() {
  const res = await callApi({ service: 'iam', method: 'GET', path: '/v3/auth/domains', region })
  const data = requireJson(res, 'iam:domains')
  const domains = data.domains ?? []
  print(data, () => {
    console.log(`共 ${domains.length} 个 domain：`)
    for (const item of domains) {
      console.log(`  ${item.enabled ? '●' : '○'} ${item.name}  ${item.id ?? ''}`)
    }
  })
  return domains
}

async function projectIdFor(targetRegion) {
  const res = await callApi({ service: 'iam', method: 'GET', path: '/v3/projects', region: targetRegion })
  const data = requireJson(res, 'ecs:projects')
  const projects = data.projects ?? []
  const hit = projects.find((p) => p.name === targetRegion) ?? projects[0]
  return hit?.id
}

async function cmdEcsServers() {
  const pid = await projectIdFor(region)
  if (!pid) fail(`找不到区域 ${region} 对应的 project，无法列举 ECS`)
  const res = await callApi({
    service: 'ecs',
    method: 'GET',
    path: `/v2.1/${pid}/servers/detail`,
    region,
  })
  const data = requireJson(res, 'ecs:servers')
  const servers = data.servers ?? []
  print(data, () => {
    if (servers.length === 0) {
      console.log(`区域 ${region}（project ${pid.slice(0, 8)}…）下没有 ECS 云服务器`)
      return
    }
    console.log(`区域 ${region} 共 ${servers.length} 台 ECS：`)
    for (const s of servers) {
      const ip = s.addresses ? Object.values(s.addresses).flat().map((a) => a.addr).join(',') : '-'
      console.log(`  ${s.name} (${String(s.id).slice(0, 8)}) ${s.status} ${s.flavor?.id ?? ''} ${ip}`)
    }
  })
  return servers
}

async function cmdRegions() {
  const res = await callApi({ service: 'iam', method: 'GET', path: '/v3/regions', region })
  const data = requireJson(res, 'regions')
  const regions = data.regions ?? []
  print(data, () => {
    if (!regions.length) return console.log('未返回区域列表')
    console.log(`共 ${regions.length} 个区域（展示前 12 个）：`)
    for (const r of regions.slice(0, 12)) {
      const label = r.locales?.['zh-cn'] ?? r.locales?.['en-us'] ?? ''
      console.log(`  ${r.id?.padEnd(18)} ${label}`)
    }
  })
  return regions
}

async function cmdRaw() {
  const service = takeFlag('service') || argv.shift()
  const path = takeFlag('path') || argv.shift() || '/'
  const method = (takeFlag('method') || 'GET').toUpperCase()
  const bodyStr = takeFlag('body')
  if (!service) fail('raw 需要 --service')
  const res = await callApi({
    service,
    method,
    path,
    body: bodyStr && bodyStr !== true ? bodyStr : undefined,
    region,
  })
  if (asJson) {
    console.log(JSON.stringify({ status: res.status, body: res.json ?? res.text }, null, 2))
    return
  }
  if (!quiet) console.log(`HTTP ${res.status}  ${service} ${method} ${path}`)
  console.log(JSON.stringify(res.json ?? res.text, null, 2))
  if (!res.ok) process.exitCode = 1
}

function mask(value) {
  if (!value) return ''
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

async function main() {
  switch (command) {
    case 'whoami':
      return cmdWhoami()
    case 'iam:domains':
      return cmdDomains()
    case 'ecs:servers':
      return cmdEcsServers()
    case 'regions':
      return cmdRegions()
    case 'raw':
      return cmdRaw()
    case 'help':
    case '--help':
    case '-h':
      return console.log(help)
    default:
      fail(`未知命令: ${command}\n\n${help}`, 2)
  }
}

main().catch((err) => fail(err.message))
