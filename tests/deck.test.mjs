#!/usr/bin/env node
// tests/deck.test.mjs —— 校验大纲与产出（调用 python-pptx 复读生成结果）
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'scripts/build_deck.py')

function py(code) {
  return execFileSync('python', ['-c', code], { encoding: 'utf8', cwd: ROOT })
}

function buildDeck(contentPath, outPath, theme) {
  const args = [BUILD, '--content', contentPath, '--out', outPath]
  if (theme) args.push('--theme', theme)
  return execFileSync('python', args, { encoding: 'utf8', cwd: ROOT })
}

function slideCount(path) {
  const out = py(`from pptx import Presentation;print(len(Presentation(r'${path}').slides))`)
  return Number(out.trim())
}

test('demo 大纲是合法 JSON 且含封面与内容页', () => {
  const content = JSON.parse(readFileSync(join(ROOT, 'content/demo.json'), 'utf8'))
  assert.ok(content.title)
  assert.ok(Array.isArray(content.slides) && content.slides.length >= 4)
  for (const spec of content.slides) {
    assert.ok(['section', 'bullets', 'two-column', 'table', 'quote'].includes(spec.layout), `未知布局 ${spec.layout}`)
  }
})

test('构建 demo 生成 pptx，页数 = 1 + slides 数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-'))
  const out = join(dir, 'demo.pptx')
  const content = JSON.parse(readFileSync(join(ROOT, 'content/demo.json'), 'utf8'))
  const stdout = buildDeck(join(ROOT, 'content/demo.json'), out)
  assert.ok(existsSync(out), '应生成 pptx 文件')
  assert.match(stdout, /#slides=\d+/)
  assert.equal(slideCount(out), 1 + content.slides.length)
})

test('table 布局产出真实表格形状', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-'))
  const out = join(dir, 'table.pptx')
  const spec = {
    title: 'T',
    theme: 'light',
    slides: [{ layout: 'table', title: '数据', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] }],
  }
  const contentPath = join(dir, 'c.json')
  writeFileSync(contentPath, JSON.stringify(spec), 'utf8')
  buildDeck(contentPath, out)
  const info = py(
    `from pptx import Presentation
p=Presentation(r'${out}')
s=p.slides[1]
for sh in s.shapes:
    if sh.has_table: print(len(sh.table.rows), len(sh.table.columns))`,
  ).trim()
  assert.equal(info, '3 2', '表头 1 行 + 数据 2 行，2 列')
})

test('--theme dark 可覆盖大纲主题且不报错', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-'))
  const out = join(dir, 'dark.pptx')
  const stdout = buildDeck(join(ROOT, 'content/demo.json'), out, 'dark')
  assert.match(stdout, /#slides=\d+/)
  assert.ok(slideCount(out) >= 2)
})

test('缺少 --content 时报参数错误（非零退出）', () => {
  assert.throws(() => execFileSync('python', [BUILD, '--out', 'x.pptx'], { stdio: 'pipe' }))
})
