# CSS 精准微调台（浏览器内网页精调）

在浏览器里**点中任意元素**，用滑杆做像素级调整，实时预览，最后把改动导出成**可直接粘贴的 CSS 规则**——而不是一堆内联样式。

用于「页面看起来差一点，但说不清差在哪」的场景：内边距、字号、圆角、间距、颜色，调到满意再一次性拿走 CSS。

## 能力

| 能力 | 说明 |
|------|------|
| 元素选取 | 点击即选，`data-testid` / `id` / 唯一 class 组合优先，退化到 `nth-child` 路径 |
| 实时调整 | `padding` / `margin` / `font-size` / `border-radius` / `gap` + 文字色与背景色 |
| 撤销 | 栈式快照，可逐步回退；`还原预览` 一键清掉所有内联覆盖 |
| 导出 | 同一元素多次调整自动合并成一条规则；空规则不输出 |
| 零依赖 | 原生 DOM + ES Module，不需要构建、不需要框架 |

## 选择器策略（为什么不用一股脑 nth-child）

1. `data-testid` —— 最稳，测试与自动化都认它
2. `id` —— 唯一，直接可用
3. `tag.class1.class2` —— **先验证唯一**，唯一才用；否则补 `:nth-of-type(n)`
4. 兜底：从 `body` 开始逐层 `:nth-child(n)` 的完整路径

这样导出的 CSS 在真实工程里复制过去就能命中，不会因为页面上多了一个兄弟节点就失效。

## 快速开始

直接用静态服务器打开（ES Module 需要 http 环境）：

```bash
python -m http.server 8144
# 浏览器访问 http://127.0.0.1:8144/index.html
```

操作：点左侧卡片里的标题 → 拖动 `font-size` 滑杆 → 右侧「生成的 CSS」实时更新 → 点「复制 CSS」。

## 实测

用 headless Chromium 跑了一遍真实交互：

```
SELECTOR: [data-testid="demo-title"]
RANGE_COUNT: 5
CSS_OUT: "[data-testid=\"demo-title\"] {\n  font-size: 32px;\n}"
FONT_AFTER_ADJUST: 32px | AFTER_UNDO: 18px
ERRORS: none
```

即：选中 → 调到 32px 生效 → 撤销后回到原始 18px → 导出正确规则 → 控制台零错误。

## 目录结构

```
css-surgeon/
├─ index.html            # 微调台界面（含示例卡片）
├─ src/surgeon.js        # 引擎：选择器生成 / 样式读取 / 调整记录 / 撤销 / 导出 CSS
└─ tests/surgeon.test.mjs # 9 例纯逻辑单测（假元素模拟 DOM）
```

## 设计取舍

- **只改少数关键属性**：属性越多，界面越难用；先把最高频的五个盒模型属性做顺手。
- **预览用内联、导出用规则**：内联便于即时生效，导出时剥离成规则便于落地。
- **记录按选择器聚合**：同一元素多次拖动只产生一条规则，不会刷出一堆重复块。
- **不做全站扫描**：精调是"人就近改"，不是"批量重构"，保持单元素操作模型。
