# hwcli —— 把华为云服务封装成 CLI

不装官方 SDK，纯 Node（零依赖）实现华为云 **SDK-HMAC-SHA256** 请求签名，把 IAM / ECS 等服务封装成一条命令就能用的 CLI。

## 命令

| 命令 | 作用 | 实测 |
|------|------|------|
| `whoami` | 用 AK/SK 调 `/v3/auth/domains` 确认调用身份 | ✅ 返回 `hid_4rzvurtyybcgwic` |
| `iam:domains` | 列出账号下的 domain | ✅ 1 个 |
| `regions` | 列出可用区域 | ✅ 26 个 |
| `ecs:servers` | 列出指定区域的 ECS 云服务器（自动查 project id） | ✅ 正常返回空列表 |
| `raw --service <s> --path <p>` | 直接调任意已签名接口 | ✅ |

全局参数：`--region <region>`（默认 `cn-north-4`）、`--json`、`--quiet`。

## 快速开始

```powershell
$env:HUAWEICLOUD_SDK_AK = "你的 AK"
$env:HUAWEICLOUD_SDK_SK = "你的 SK"

node src/hwcli.mjs whoami
node src/hwcli.mjs regions
node src/hwcli.mjs ecs:servers --region cn-north-4
node src/hwcli.mjs raw --service iam --path /v3/projects --json
```

实测输出：

```
AK           : HPUA****ALWW
区域         : cn-north-4
账号 Domain  : hid_4rzvurtyybcgwic  (01a13545f83970bf9c36d60a43e80d36)
签名校验     : 通过
```

## 目录结构

```
hwcloud-cli/
├─ package.json
├─ src/
│  ├─ signer.mjs   # SDK-HMAC-SHA256 签名（纯 crypto，零依赖）
│  ├─ client.mjs   # 带签名的请求封装 + endpoint 规则 + 凭证读取
│  └─ hwcli.mjs    # 命令入口（whoami / iam:domains / regions / ecs:servers / raw）
└─ tests/
   └─ signer.test.mjs  # 8 条签名单测（固定时间可复现）
```

## 签名实现要点（三个坑）

和 AWS SigV4 不同，华为云 `SDK-HMAC-SHA256` **只有一次 HMAC**，签名密钥直接就是 SK，没有 date/region/service 四级派生。真正的坑在这三处：

1. **CanonicalURI 必须补尾部 `/`**
   签名用 `/v3/auth/domains/`，但真实请求路径不带斜杠。少一个斜杠就是 401。
2. **CanonicalHeaders 块本身以换行结尾**
   拼接时会多出一个空行，`头块` 与 `SignedHeaders` 之间必须有一条空行。
3. **参与签名的头必须与实际发出的头完全一致**（小写、字典序、`;` 连接）

> 排查技巧：华为云 401 会在 `error_msg` 里回显它自己算出的 `canonical_request`（`|` 是换行的可视化）。把它和自己的拼出来的一对比，差异立刻现形 —— 本次就是靠这个发现「头块尾随换行」这一条。

## 单测

```
✔ sdkDate 生成 UTC 紧凑格式
✔ uriEncode 保留 -_.~ 并转义特殊字符
✔ canonicalQueryString 按 key 排序并编码
✔ sha256Hex 对空串有固定值
✔ signRequest 产出确定性的 Authorization
✔ canonicalRequest 结构符合规范
✔ 签名只依赖 SK 与 stringToSign
✔ 安全令牌参与签名并出现在请求头
tests 8 / pass 8 / fail 0
```

## 与官方 SDK 的一致性

本实现与 `huaweicloudsdkcore`（Python 官方 SDK）做了逐字节比对：对同一 `CanonicalRequest` 与同一 `X-Sdk-Date`，两者算出的签名完全相同；并用真实账号跑通了 `whoami` / `regions` / `ecs:servers` 三个需要真实签名校验的接口。
