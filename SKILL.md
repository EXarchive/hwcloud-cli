---
name: office-email-send
description: |
  在 Agent 办公场景中安全地发邮件：模板渲染 → 双正文（纯文本 + HTML）→ 批量收件人 → dry-run 预检 → 显式 --send 才投递。
  Use when the user wants the agent to 发周报 / 发通知 / 批量发邮件 / 用模板群发,
  "send a weekly report email" "email this list of people" "发一封通知邮件".
  默认 dry-run，不会在用户没明确要求时把邮件真的发出去。
metadata:
  tags: office, email, smtp, template
  version: 2026.10.31.001
---

# 办公邮件发送（Agent 实践）

把「发邮件」拆成**构造**与**投递**两段：构造全程纯函数、可单测；投递默认关闭，必须显式 `--send`。这样 Agent 可以放心地生成邮件内容，而不会误发。

## 用法

```bash
# 1) 模板 + 变量（默认 dry-run，只打印报文头）
node scripts/send-mail.mjs \
  --to "张 三 <zhang@example.com>,li@example.com" \
  --subject "第 43 周周报" \
  --template weekly \
  --vars '{"title":"第43周周报","name":"张三","summary":"...","highlights":"...","footer":"自动发送，勿回"}'

# 2) 纯文本正文
node scripts/send-mail.mjs --to a@b.com --subject hi --text "hello"

# 3) 正文从文件读
node scripts/send-mail.mjs --to a@b.com --subject 通知 --text-file body.txt

# 4) 批量：收件人从 CSV 读取（含 email 列，或每行一个邮箱）
node scripts/send-mail.mjs --to recipients.csv --subject 通知 --template notice --vars '{...}'
```

dry-run 输出：

```
#dryRun=true
#to=2
#bytes=2437
#subject=第 43 周周报
--- 报文头 ---
From: me@example.com
To: =?UTF-8?B?5bygIOS4iQ==?= <zhang@example.com>, li@example.com
Subject: =?UTF-8?B?56ysIDQzIOWRqOWRqOaKpQ==?=
```

## 安全设计

| 设计 | 原因 |
|------|------|
| **默认 dry-run** | Agent 最常见的错误是"顺手发出去"，默认不投递把风险降到最低 |
| 真实发送要 `--send` + `SMTP_*` 环境变量 | 显式两步确认，且凭证只从环境变量读 |
| 模板变量缺失只 WARN 不中断 | 允许先出草稿，人再补内容 |
| 收件人解析失败直接 exit 1 | 宁可失败，不要发给空地址 |

## 报文构造（`scripts/mime.mjs`）

- **双正文**：`multipart/alternative` 同时挂 `text/plain` 与 `text/html`，纯文本由 HTML 去标签生成，保证任何客户端都能读；
- **中文安全**：标题与收件人名按 RFC 2047 Base64 编码（`=?UTF-8?B?...?=`），避免中文主题在部分客户端变乱码；
- **长行折叠**：头部按 76 列折行，正文 base64 每 76 字符换行，符合 RFC 5322；
- **附件**：有附件时自动切 `multipart/mixed`，嵌套 alternative 部分。

## 模板

`templates/` 下是可直接用的模板，占位符语法为 `{{key}}`：

| 模板 | 用途 |
|------|------|
| `weekly.html` | 周报：标题条 + 称呼 + 摘要 + 要点 + 落款 |
| `notice.html` | 通用通知：标题 + 正文 + 发件人 |

## 单测

```
✔ encodeHeaderValue 纯 ASCII 原样返回
✔ encodeHeaderValue 中文按 RFC2047 Base64 编码
✔ addressList 支持带名字与逗号分隔
✔ foldHeader 折行不超过限制
✔ wrap76 每行不超过 76 字符
✔ buildMessage 生成 multipart/alternative 双正文（含 base64 解码回验）
✔ buildMessage 有附件时切 multipart/mixed
✔ renderTemplate 替换占位并在缺失时报告
✔ renderTemplate 无缺失时 missing 为空
tests 9 / pass 9 / fail 0
```

## 已知边界

- 真实 SMTP 投递需要用带 TLS 的 SMTP 客户端库；本脚本把「构造」做完整、把「投递」留成显式出口，避免把凭据与网络依赖塞进 Agent 环境。
- 模板只支持 `{{key}}` 变量替换，不做条件/循环；需要复杂排版请在模板里直接写死结构，用变量填值。
