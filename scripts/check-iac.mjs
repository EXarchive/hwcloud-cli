#!/usr/bin/env node
// check-iac.mjs —— Web 服务部署 IaC 结构校验（无需 Terraform 二进制）
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tfDir = resolve(ROOT, 'terraform')
if (!existsSync(tfDir)) {
  console.error('❌ 缺少 terraform 目录')
  process.exit(1)
}
const files = readdirSync(tfDir).filter((f) => f.endsWith('.tf'))
const src = files.map((f) => readFileSync(join(tfDir, f), 'utf8')).join('\n')

const checks = [
  { id: 'provider', desc: 'huaweicloud provider', test: (s) => /provider\s+"huaweicloud"/.test(s) },
  { id: 'vpc', desc: 'VPC + 子网', test: (s) => /huaweicloud_vpc"/.test(s) && /huaweicloud_vpc_subnet/.test(s) },
  { id: 'sg', desc: '安全组放行应用端口与 SSH', test: (s) => /port_range_min\s*=\s*var\.app_port/.test(s) && /port_range_min\s*=\s*22/.test(s) },
  { id: 'archive', desc: 'OBS 归档桶（私有 + 版本控制）', test: (s) => /huaweicloud_obs_bucket[\s\S]*?acl\s*=\s*"private"[\s\S]*?versioning\s*=\s*true/.test(s) },
  { id: 'object', desc: '发布包上传且用 filemd5 校验', test: (s) => /huaweicloud_obs_bucket_object[\s\S]*?etag\s*=\s*filemd5\(var\.release_zip\)/.test(s) },
  { id: 'ecs', desc: 'ECS 实例', test: (s) => /huaweicloud_compute_instance/.test(s) },
  { id: 'userdata', desc: 'user_data 启动脚本（拉包并启动）', test: (s) => /user_data\s*=\s*local\.user_data/.test(s) && /curl -fsSL/.test(s) },
  { id: 'outputs', desc: '输出归档对象/ETag/访问地址', test: (s) => ['release_object', 'release_etag', 'app_endpoints'].every((k) => new RegExp(`output\\s+"${k}"`).test(s)) },
  { id: 'sensitive', desc: '密码标 sensitive', test: (s) => /sensitive\s*=\s*true/.test(s) },
  { id: 'no_secret', desc: '不硬编码 AK/SK', test: (s) => !/(ak|sk)\s*=\s*"[A-Za-z0-9]{16,}"/.test(s) },
]

let failed = 0
for (const c of checks) {
  const ok = c.test(src)
  if (!ok) failed++
  console.log(`${ok ? '✔' : '✖'} ${c.id.padEnd(10)} ${c.desc}`)
}

const zipPath = resolve(ROOT, 'dist/app.zip')
const hasZip = existsSync(zipPath)
console.log(`${hasZip ? '✔' : '✖'} ${'release'.padEnd(10)} dist/app.zip 存在（先跑 pack-release.mjs）`)
if (!hasZip) failed++

console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
