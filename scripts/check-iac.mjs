#!/usr/bin/env node
// check-iac.mjs —— 在没有 Terraform 二进制时也能校验 IaC 关键要素是否齐全
//
// 用法: node scripts/check-iac.mjs [--dir terraform]
// 退出码: 0=全部通过; 1=缺项

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dirIdx = args.indexOf('--dir')
const tfDir = resolve(ROOT, dirIdx >= 0 && args[dirIdx + 1] ? args[dirIdx + 1] : 'terraform')

const checks = [
  { id: 'provider', desc: '声明 huaweicloud provider', test: (src) => /provider\s+"huaweicloud"/.test(src) },
  { id: 'bucket', desc: '声明 OBS 桶资源', test: (src) => /resource\s+"huaweicloud_obs_bucket"\s+"site"/.test(src) },
  { id: 'website', desc: '配置静态网站首页', test: (src) => /website\s*\{[\s\S]*?index_document/.test(src) },
  { id: 'errorpage', desc: '配置错误页', test: (src) => /error_document/.test(src) },
  { id: 'upload', desc: '对象上传用 for_each 遍历目录', test: (src) => /for_each\s*=\s*local\.site_files/.test(src) },
  { id: 'contenttype', desc: '按扩展名设置 Content-Type', test: (src) => /content_type\s*=\s*lookup\(local\.content_types/.test(src) },
  { id: 'etag', desc: '用 filemd5 做 ETag 保证幂等', test: (src) => /etag\s*=\s*filemd5\(/.test(src) },
  { id: 'referer', desc: '防盗链配置（可开关）', test: (src) => /huaweicloud_obs_bucket_referer/.test(src) },
  { id: 'policy', desc: '桶策略（IP 黑名单 deny）', test: (src) => /huaweicloud_obs_bucket_policy[\s\S]*?Deny/.test(src) },
  { id: 'outputs', desc: '输出访问地址与对象数', test: (src) => /output\s+"website_endpoint"/.test(src) && /output\s+"object_count"/.test(src) },
  { id: 'vars', desc: '变量化（bucket_name/region 等）', test: (src) => /variable\s+"bucket_name"/.test(src) && /variable\s+"region"/.test(src) },
  { id: 'no_secret', desc: '不硬编码 AK/SK', test: (src) => !/(ak|sk)\s*=\s*"[A-Za-z0-9]{16,}"/.test(src) },
]

if (!existsSync(tfDir)) {
  console.error(`❌ 找不到 Terraform 目录: ${tfDir}`)
  process.exit(1)
}

const files = readdirSync(tfDir).filter((f) => f.endsWith('.tf'))
if (files.length === 0) {
  console.error(`❌ ${tfDir} 下没有 .tf 文件`)
  process.exit(1)
}

const src = files.map((f) => readFileSync(join(tfDir, f), 'utf8')).join('\n')

let failed = 0
for (const check of checks) {
  const ok = check.test(src)
  if (!ok) failed++
  console.log(`${ok ? '✔' : '✖'} ${check.id.padEnd(12)} ${check.desc}`)
}

// 站点目录必须存在 index.html，否则 apply 出来是 404
const siteDir = resolve(ROOT, 'site')
const hasIndex = existsSync(join(siteDir, 'index.html'))
console.log(`${hasIndex ? '✔' : '✖'} ${'site'.padEnd(12)} site/index.html 存在`)
if (!hasIndex) failed++

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}（${files.length} 个 .tf 文件）`)
process.exit(failed === 0 ? 0 : 1)
