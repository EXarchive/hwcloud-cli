// surgeon.js —— 页面元素「精准微调」引擎
//
// 目标：在浏览器里点中一个元素，用键盘/滑杆做像素级调整，实时预览，
// 并且把最终改动导出成可直接粘贴的 CSS 规则（而不是一堆内联样式）。
//
// 设计要点：
//   1. 选择器优先用稳定标识：data-testid > id > 唯一的 class 组合 > 带 nth-child 的路径
//   2. 调整项以「属性名 → 值」记录，同一元素多次调整会合并成一条规则
//   3. 预览用内联 style 临时覆盖，导出时把内联值剥离成规则文本
//   4. 支持撤销（栈式快照），避免实验性调整破坏原页面

const ADJUSTABLE = [
  { key: 'padding', unit: 'px', min: 0, max: 64, step: 1 },
  { key: 'margin', unit: 'px', min: -32, max: 64, step: 1 },
  { key: 'font-size', unit: 'px', min: 8, max: 72, step: 1 },
  { key: 'border-radius', unit: 'px', min: 0, max: 48, step: 1 },
  { key: 'gap', unit: 'px', min: 0, max: 48, step: 1 },
]

/** 为元素生成尽量稳定的选择器 */
export function selectorFor(el) {
  if (!el || el.nodeType !== 1) return ''
  if (el.dataset?.testid) return `[data-testid="${el.dataset.testid}"]`
  if (el.id) return `#${el.id}`

  const classes = [...(el.classList ?? [])].filter((c) => !c.startsWith('is-'))
  if (classes.length > 0) {
    const candidate = `${el.tagName.toLowerCase()}.${classes.join('.')}`
    // 只有在同 tag+class 组合唯一时才用，否则退回路径
    if (document.querySelectorAll(candidate).length === 1) return candidate
    return `${candidate}:nth-of-type(${indexOfType(el)})`
  }

  const parts = []
  let node = el
  while (node && node.nodeType === 1 && node !== document.body) {
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${childIndex(node)})`)
    node = node.parentElement
  }
  return `body > ${parts.join(' > ')}`
}

function childIndex(el) {
  let i = 1
  let sib = el
  while ((sib = sib.previousElementSibling)) i++
  return i
}

function indexOfType(el) {
  let i = 1
  let sib = el
  while ((sib = sib.previousElementSibling)) {
    if (sib.tagName === el.tagName) i++
  }
  return i
}

/** 读取元素当前的数值型样式 */
export function readStyles(el) {
  const cs = getComputedStyle(el)
  const out = {}
  for (const item of ADJUSTABLE) {
    out[item.key] = Math.round(parseFloat(cs.getPropertyValue(item.key)) || 0)
  }
  out['font-size'] = Math.round(parseFloat(cs.fontSize) || 0)
  out.color = rgbToHex(cs.color)
  out['background-color'] = rgbToHex(cs.backgroundColor)
  return out
}

export function rgbToHex(rgb) {
  if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') return ''
  const m = String(rgb).match(/rgba?\(([^)]+)\)/)
  if (!m) return rgb.startsWith('#') ? rgb : ''
  const [r, g, b] = m[1].split(',').map((v) => Number(v.trim()))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 调整引擎：记录改动、实时预览、导出 CSS
 */
export class Surgeon {
  constructor() {
    this.changes = new Map() // selector -> { el, props: Map<k, v> }
    this.history = []
  }

  /** 选中元素并返回可调整的初始值 */
  select(el) {
    const selector = selectorFor(el)
    if (!this.changes.has(selector)) {
      this.changes.set(selector, { el, props: new Map() })
    }
    return { selector, styles: readStyles(el), adjustable: ADJUSTABLE }
  }

  /** 应用一次调整（同时写入内联样式用于预览） */
  apply(selector, prop, value) {
    const entry = this.changes.get(selector)
    if (!entry) return false
    this.history.push({ selector, prop, prev: entry.props.get(prop) })
    entry.props.set(prop, value)
    const cssValue = needsUnit(prop) ? `${value}px` : value
    entry.el.style.setProperty(prop, cssValue)
    return true
  }

  /** 撤销最近一次调整 */
  undo() {
    const last = this.history.pop()
    if (!last) return false
    const entry = this.changes.get(last.selector)
    if (!entry) return false
    if (last.prev === undefined) {
      entry.props.delete(last.prop)
      entry.el.style.removeProperty(last.prop)
    } else {
      entry.props.set(last.prop, last.prev)
      entry.el.style.setProperty(last.prop, needsUnit(last.prop) ? `${last.prev}px` : last.prev)
    }
    return true
  }

  /** 导出为 CSS 文本 */
  toCSS() {
    const blocks = []
    for (const [selector, entry] of this.changes) {
      if (entry.props.size === 0) continue
      const decls = [...entry.props.entries()]
        .map(([prop, value]) => `  ${prop}: ${needsUnit(prop) ? `${value}px` : value};`)
        .join('\n')
      blocks.push(`${selector} {\n${decls}\n}`)
    }
    return blocks.join('\n\n')
  }

  /** 把预览内联样式全部还原（不丢记录） */
  revertPreview() {
    for (const [, entry] of this.changes) {
      for (const prop of entry.props.keys()) entry.el.style.removeProperty(prop)
    }
  }

  reset() {
    this.revertPreview()
    this.changes.clear()
    this.history = []
  }
}

function needsUnit(prop) {
  return !['color', 'background-color'].includes(prop)
}

export { ADJUSTABLE }
