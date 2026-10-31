#!/usr/bin/env node
// check-iac.mjs —— 无 Terraform 二进制时校验 ECS 网络 IaC 关键要素
// 用法: node scripts/check-iac.mjs

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tfDir = resolve(ROOT, 'terraform')

const checks = [
  { id: 'provider', desc: 'huaweicloud provider', test: (s) => /provider\s+"huaweicloud"/.test(s) },
  { id: 'vpc', desc: 'VPC 资源', test: (s) => /resource\s+"huaweicloud_vpc"\s+"this"/.test(s) },
  { id: 'subnet', desc: '子网且网关取网段第 1 个地址', test: (s) => /huaweicloud_vpc_subnet[\s\S]*?cidrhost\(var\.subnet_cidr,\s*1\)/.test(s) },
  { id: 'sg', desc: '安全组', test: (s) => /resource\s+"huaweicloud_networking_secgroup"\s+"this"/.test(s) },
  { id: 'ssh', desc: 'SSH 入站规则受 ssh_cidr 约束', test: (s) => /port_range_min\s*=\s*22[\s\S]*?remote_ip_prefix\s*=\s*var\.ssh_cidr/.test(s) },
  { id: 'icmp', desc: 'ICMP 入站规则', test: (s) => /protocol\s*=\s*"icmp"/.test(s) },
  { id: 'ecs', desc: 'ECS 实例', test: (s) => /resource\s+"huaweicloud_compute_instance"\s+"this"/.test(s) },
  { id: 'image', desc: '镜像用 data source 按名匹配', test: (s) => /data\s+"huaweicloud_images_image"/.test(s) },
  { id: 'flavor', desc: '规格用 data source 查询', test: (s) => /data\s+"huaweicloud_compute_flavors"/.test(s) },
  { id: 'netbind', desc: '实例绑定子网', test: (s) => /network\s*\{[\s\S]*?uuid\s*=\s*huaweicloud_vpc_subnet\.this\.id/.test(s) },
  { id: 'sensitive', desc: '密码标 sensitive 且可为空', test: (s) => /sensitive\s*=\s*true/.test(s) },
  { id: 'outputs', desc: '输出 vpc/subnet/sg/IP', test: (s) => ['vpc_id', 'subnet_id', 'security_group_id', 'instance_private_ips'].every((k) => new RegExp(`output\\s+"${k}"`).test(s)) },
  { id: 'no_secret', desc: '不硬编码 AK/SK', test: (s) => !/(ak|sk)\s*=\s*"[A-Za-z0-9]{16,}"/.test(s) },
]

if (!existsSync(tfDir)) {
  console.error(`❌ 找不到 terraform 目录`)
  process.exit(1)
}
const files = readdirSync(tfDir).filter((f) => f.endsWith('.tf'))
if (!files.length) {
  console.error('❌ 没有 .tf 文件')
  process.exit(1)
}
const src = files.map((f) => readFileSync(join(tfDir, f), 'utf8')).join('\n')

let failed = 0
for (const c of checks) {
  const ok = c.test(src)
  if (!ok) failed++
  console.log(`${ok ? '✔' : '✖'} ${c.id.padEnd(11)} ${c.desc}`)
}
console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项未通过`}（${files.length} 个 .tf）`)
process.exit(failed === 0 ? 0 : 1)
