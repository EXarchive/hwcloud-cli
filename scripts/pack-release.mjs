#!/usr/bin/env node
// pack-release.mjs —— 把 app/ 打成 dist/app.zip 并输出 MD5（供 terraform 的 etag 校验）
// 用法: node scripts/pack-release.mjs [--src app] [--out dist/app.zip]

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const srcDir = resolve(ROOT, getArg('src', 'app'))
const outFile = resolve(ROOT, getArg('out', 'dist/app.zip'))

if (!existsSync(srcDir)) {
  console.error(`❌ 源目录不存在: ${srcDir}`)
  process.exit(1)
}

// ---- 极简 ZIP 写入（store/deflate，无第三方依赖）----
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full, base))
    else out.push({ full, rel: relative(base, full).split('\\').join('/') })
  }
  return out
}

const files = walk(srcDir)
const locals = []
const centrals = []
let offset = 0

for (const file of files) {
  const data = readFileSync(file.full)
  const nameBuf = Buffer.from(file.rel, 'utf8')
  const crc = crc32(data)
  const compressed = deflateRawSync(data, { level: 9 })
  const useDeflate = compressed.length < data.length
  const payload = useDeflate ? compressed : data
  const method = useDeflate ? 8 : 0

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(0, 10) // time
  local.writeUInt16LE(0, 12) // date
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(payload.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)

  locals.push(local, nameBuf, payload)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(0, 8)
  central.writeUInt16LE(method, 10)
  central.writeUInt16LE(0, 12)
  central.writeUInt16LE(0, 14)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(payload.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt16LE(0, 30)
  central.writeUInt16LE(0, 32)
  central.writeUInt16LE(0, 34)
  central.writeUInt16LE(0, 36)
  central.writeUInt32LE(0, 38)
  central.writeUInt32LE(offset, 42)
  centrals.push(central, nameBuf)

  offset += local.length + nameBuf.length + payload.length
}

const centralBuf = Buffer.concat(centrals)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)
end.writeUInt16LE(0, 20)

const zip = Buffer.concat([...locals, centralBuf, end])
mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, zip)

const md5 = createHash('md5').update(zip).digest('hex')
console.log(`#zip=${outFile}`)
console.log(`#files=${files.length}`)
console.log(`#bytes=${zip.length}`)
console.log(`#md5=${md5}`)
