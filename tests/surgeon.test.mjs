#!/usr/bin/env node
// tests/surgeon.test.mjs —— 纯逻辑单测（用最小假元素替代真实 DOM）
import test from 'node:test'
import assert from 'node:assert/strict'
import { ADJUSTABLE, Surgeon, rgbToHex } from '../src/surgeon.js'

function fakeEl() {
  const props = new Map()
  return {
    style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
    },
    _props: props,
  }
}

function seed(surgeon, selector, el) {
  surgeon.changes.set(selector, { el, props: new Map() })
}

test('rgbToHex 转换 rgb 与 rgba', () => {
  assert.equal(rgbToHex('rgb(255, 0, 0)'), '#ff0000')
  assert.equal(rgbToHex('rgba(0, 128, 255, 0.5)'), '#0080ff')
  assert.equal(rgbToHex('rgba(0, 0, 0, 0)'), '')
  assert.equal(rgbToHex('#abc'), '#abc')
})

test('可调项定义完整且 step 为正', () => {
  assert.ok(ADJUSTABLE.length >= 5)
  for (const item of ADJUSTABLE) {
    assert.ok(item.key && item.unit, '需要 key 与 unit')
    assert.ok(item.step > 0, `${item.key} 的 step 必须为正`)
    assert.ok(item.max > item.min, `${item.key} 的 max 应大于 min`)
  }
})

test('apply 写入内联样式并记录属性', () => {
  const s = new Surgeon()
  const el = fakeEl()
  seed(s, '.a', el)
  s.apply('.a', 'padding', 12)
  assert.equal(el._props.get('padding'), '12px')
  assert.equal(s.changes.get('.a').props.get('padding'), 12)
})

test('颜色属性不加 px 单位', () => {
  const s = new Surgeon()
  const el = fakeEl()
  seed(s, '.a', el)
  s.apply('.a', 'color', '#ff0000')
  assert.equal(el._props.get('color'), '#ff0000')
})

test('undo 能回退到上一个值，首次调整则移除属性', () => {
  const s = new Surgeon()
  const el = fakeEl()
  seed(s, '.a', el)

  s.apply('.a', 'font-size', 20)
  s.apply('.a', 'font-size', 28)
  assert.equal(el._props.get('font-size'), '28px')

  assert.equal(s.undo(), true)
  assert.equal(el._props.get('font-size'), '20px')

  assert.equal(s.undo(), true)
  assert.equal(el._props.has('font-size'), false)
  assert.equal(s.changes.get('.a').props.size, 0)

  assert.equal(s.undo(), false, '没有历史时返回 false')
})

test('toCSS 把记录导出成规则文本，空规则不输出', () => {
  const s = new Surgeon()
  const el1 = fakeEl()
  const el2 = fakeEl()
  seed(s, '.a', el1)
  seed(s, '.b', el2)

  s.apply('.a', 'padding', 8)
  s.apply('.a', 'font-size', 16)

  const css = s.toCSS()
  assert.match(css, /^\.a \{$/m)
  assert.ok(css.includes('  padding: 8px;'))
  assert.ok(css.includes('  font-size: 16px;'))
  assert.ok(!css.includes('.b'), '没有改动的元素不应输出')
})

test('revertPreview 清掉内联样式但保留记录', () => {
  const s = new Surgeon()
  const el = fakeEl()
  seed(s, '.a', el)
  s.apply('.a', 'margin', 4)
  s.revertPreview()
  assert.equal(el._props.has('margin'), false)
  assert.equal(s.changes.get('.a').props.get('margin'), 4, '记录仍在')
})

test('reset 清空所有状态', () => {
  const s = new Surgeon()
  const el = fakeEl()
  seed(s, '.a', el)
  s.apply('.a', 'padding', 6)
  s.reset()
  assert.equal(s.changes.size, 0)
  assert.equal(s.history.length, 0)
  assert.equal(el._props.size, 0)
})

test('未选中的 selector 调用 apply 返回 false', () => {
  const s = new Surgeon()
  assert.equal(s.apply('.nope', 'padding', 1), false)
})
