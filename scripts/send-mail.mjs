#!/usr/bin/env node
// send-mail.mjs —— Agent 办公实践：发邮件（含模板渲染、批量收件人、dry-run）
//
// 用法:
//   node scripts/send-mail.mjs --to a@b.com --subject "周报" --template weekly --vars '{"name":"张三","week":43}'
//   node scripts/send-mail.mjs --to list.csv --subject "通知" --text-file body.txt --dry-run
//   node scripts/send-mail.mjs --to a@b.com --subject hi --text "hello" --smtp smtp.example.com:465
//
// 环境变量（真实发送时需要）:
//   SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS SMTP_SECURE
//
// 安全默认：不带 --send 时一律 dry-run，只打印报文头与长度，不发信。

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMessage } from './mime.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
function takeFlag(name) {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) return true
  argv.splice(i, 2)
  return v
}

const dryRun = !argv.includes('--send')
const to = takeFlag('to')
const cc = takeFlag('cc')
const subject = takeFlag('subject') || '(无主题)'
const templateName = takeFlag('template')
const varsJson = takeFlag('vars')
const textArg = takeFlag('text')
const textFile = takeFlag('text-file')
const from = takeFlag('from') || process.env.SMTP_USER || 'me@example.com'

function fail(msg) {
  console.error(`ERROR ${msg}`)
  process.exit(1)
}

/** 极简模板渲染：{{key}} 占位，缺值保留原样并告警 */
export function renderTemplate(tpl, vars) {
  const missing = []
  const out = tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    if (vars[key] === undefined) {
      missing.push(key)
      return `{{${key}}}`
    }
    return String(vars[key])
  })
  return { out, missing }
}

function loadTemplate(name) {
  const file = join(ROOT, 'templates', `${name}.html`)
  if (!existsSync(file)) fail(`找不到模板: templates/${name}.html`)
  return readFileSync(file, 'utf8')
}

/** 收件人支持 CSV（每行一个邮箱，或含 email 列） */
function loadRecipients(value) {
  if (!value) fail('缺少 --to')
  if (!value.endsWith('.csv')) return String(value)
  const file = resolve(ROOT, value)
  if (!existsSync(file)) fail(`找不到收件人文件: ${value}`)
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
  const header = lines[0].toLowerCase().includes('email') ? lines.shift().split(',') : null
  const emailIdx = header ? header.findIndex((h) => h.trim().toLowerCase() === 'email') : 0
  return lines
    .map((line) => line.split(',')[idxOr(emailIdx, 0)]?.trim())
    .filter((v) => v && v.includes('@'))
    .join(', ')
}

function idxOr(i, fallback) {
  return i >= 0 ? i : fallback
}

function main() {
  let text = textArg && textArg !== true ? textArg : ''
  if (textFile) {
    const file = resolve(ROOT, String(textFile))
    if (!existsSync(file)) fail(`找不到正文文件: ${textFile}`)
    text = readFileSync(file, 'utf8')
  }

  let html = ''
  const vars = varsJson && varsJson !== true ? JSON.parse(varsJson) : {}
  if (templateName) {
    const tpl = loadTemplate(String(templateName))
    const rendered = renderTemplate(tpl, vars)
    html = rendered.out
    if (rendered.missing.length > 0) {
      console.error(`WARN 模板变量缺失: ${[...new Set(rendered.missing)].join(', ')}`)
    }
    if (!text) {
      // 纯文本版由 HTML 去标签得到，保证双正文都可用
      text = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    }
  }

  if (!text && !html) fail('需要 --text / --text-file / --template 之一')

  const recipients = loadRecipients(to)
  const message = buildMessage({ from, to: recipients, cc: cc && cc !== true ? cc : undefined, subject, text, html })

  console.log(`#dryRun=${dryRun}`)
  console.log(`#to=${recipients.split(',').length}`)
  console.log(`#bytes=${Buffer.byteLength(message)}`)
  console.log(`#subject=${subject}`)

  if (dryRun) {
    console.log('--- 报文头 ---')
    console.log(message.split('\r\n\r\n')[0].split('\r\n').slice(0, 8).join('\n'))
    console.log('--- 提示 ---')
    console.log('这是 dry-run，未实际发信。加 --send 并提供 SMTP_* 环境变量才会投递。')
    return
  }

  // 真实发送：用 Node 内置 net/tls 说 SMTP 太重，这里委托系统 mail 命令或外部 SMTP 服务
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 465)
  if (!host) fail('缺少 SMTP_HOST')
  console.log(`#smtp=${host}:${port}`)
  console.log('真实投递需要 smtp 客户端依赖；本脚本默认只做 dry-run，请通过 --send 显式开启并自行提供发送通道。')
  process.exitCode = 2
}

if (process.argv[1] && process.argv[1].endsWith('send-mail.mjs')) main()
