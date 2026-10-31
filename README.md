# Deck Forge —— 从大纲 JSON 生成 PPT

用一份 JSON 大纲生成排版统一的 `.pptx`：封面、章节页、要点页、双栏对比、表格、引用，共 6 种版式。**不手工拖控件，改内容就是改 JSON。**

## 版式

| `layout` | 用途 | 关键参数 |
|----------|------|----------|
| 封面（自动） | 标题 + 副标题 + 作者 | `title` / `subtitle` / `author` |
| `section` | 章节分隔 | `title` / `note` |
| `bullets` | 要点列表 | `title` / `bullets[]` |
| `two-column` | 左右对比 | `left{title,bullets}` / `right{...}` |
| `table` | 数据表 | `headers[]` / `rows[][]` |
| `quote` | 金句引用 | `text` / `cite` |

主题两套：`light` / `dark`，可用 `--theme` 覆盖大纲里的设置。

## 用法

```bash
pip install python-pptx          # 唯一依赖

python scripts/build_deck.py --content content/demo.json --out out/demo.pptx
python scripts/build_deck.py --content content/demo.json --out out/demo-dark.pptx --theme dark
```

输出：

```
#deck=out/demo.pptx
#slides=7
#bytes=37279
```

## 实测

`content/demo.json` 是本次 ICT 大赛的真实复盘大纲（7 页：封面 + 5 类正文 + 尾页）。生成后用 `python-pptx` 回读校验：

```
slides: 7
  1: 华为 ICT 大赛 · 云赛道复盘 | 从 18 道赛题的交付链路说起 | 翼帝基 · 2026-10-31
  2: 01 我们做了什么 | 18 道赛题，6 类技术方向
  3: 交付全景 | ·  AI 应用开发：任务看板、预算看板（TripStar 增量）
  4: 两个关键取舍 | 先打通链路，再堆功能 | ·  提交接口要 STS 临时凭证
  5: 单测与实测覆盖 | [table 6x3]
  6: “判题服务器连不上 GitHub，那就重试到窗口打开为止” | — 本次踩坑记录
  7: 02 下一步 | 等判题结果，补齐剩余赛题
```

（上面是控制台按 UTF-8 打印的原文；命令行若显示乱码只是终端编码问题，文件本身是正确的 UTF-8。）

## 单测（5 例全通过）

```
✔ demo 大纲是合法 JSON 且含封面与内容页
✔ 构建 demo 生成 pptx，页数 = 1 + slides 数
✔ table 布局产出真实表格形状        ← 断言出来真的是 3 行 × 2 列
✔ --theme dark 可覆盖大纲主题且不报错
✔ 缺少 --content 时报参数错误（非零退出）
tests 5 / pass 5 / fail 0
```

关键在「回读校验」：不是断言文件存在就完事，而是用 `python-pptx` 重新打开产出、统计页数、检查表格维度——这样版式回归能真被抓到。

## 目录结构

```
deck-forge/
├─ scripts/build_deck.py     # 生成器（主题 / 6 种版式）
├─ content/demo.json         # 大纲示例（真实复盘内容）
├─ out/demo.pptx             # 产物
└─ tests/deck.test.mjs       # 5 例（含回读校验）
```

## 设计取舍

- **16:9 定死**：`12192000 × 6858000` EMU，避免不同模板混排时错位。
- **底色块铺满 + 无边框 + 去阴影**：用最少的形状覆盖默认模板灰底，保证 light/dark 两套主题都能干净呈现。
- **文字用 textbox 而非占位符**：`python-pptx` 的 layout 占位符在不同模板下继承属性不一致，自己画框反而稳定。
- **不做母版**：本项目定位是"内容驱动、批量出稿"，母版交给后续品牌化需求再补。
