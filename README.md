# IaC 静态网站自动化部署与访问控制

用 Terraform 把「一个静态网站」整条交付链路声明下来：**建桶 → 配静态站 → 传对象 → 配访问控制 → 输出访问地址**。全程零手工点控制台。

## 交付了什么

| 资源 | 作用 |
|------|------|
| `huaweicloud_obs_bucket.site` | OBS 桶，开启静态网站托管（首页 / 错误页），ACL 由变量控制 |
| `huaweicloud_obs_bucket_object.files` | 用 `for_each = fileset(...)` 把 `site/` 下所有文件上传，按扩展名设 Content-Type，`filemd5` 做 ETag 保证幂等 |
| `huaweicloud_obs_bucket_referer.this` | 防盗链白名单（`allowed_referers` 非空才创建） |
| `huaweicloud_obs_bucket_policy.deny_ip` | 桶策略：IP 黑名单 `Deny` GetObject/ListBucket（`ip_blacklist` 非空才创建） |
| `output.website_endpoint` | 直接给出可访问的站点地址 |

## 访问控制设计

三层，互不冲突，全部由变量开关：

1. **桶 ACL**：`allow_public_read=true` → `public-read`，静态站必须开；关掉即变私有桶，公网立刻不可访问。
2. **防盗链**：`allowed_referers` 填白名单域名，为空则不创建该资源（等价于不限制来源）。
3. **桶策略 deny**：`ip_blacklist` 填 CIDR，命中即拒绝读与列举；用 `count` 控制，空列表不落地。

> 顺序上先 ACL 放行、再用策略精确 deny，避免"全放行后再全拦"的常见反模式。

## 快速开始

```bash
export HUAWEICLOUD_SDK_AK=...
export HUAWEICLOUD_SDK_SK=...

cd terraform
terraform init
terraform plan  -var="bucket_name=my-ict-site-2026"
terraform apply -var="bucket_name=my-ict-site-2026"
```

`apply` 完成后读输出：

```
website_endpoint = "http://my-ict-site-2026.obs-website.cn-north-4.myhuaweicloud.com"
object_count     = 3
access_control   = { "ip_denied" = 0, "public_read" = true, "referer_limited" = false }
```

## 不装 Terraform 也能验

```bash
node scripts/check-iac.mjs
```

逐项校验 12 个 IaC 关键要素（provider / 桶 / website / 错误页 / for_each 上传 / Content-Type / ETag 幂等 / 防盗链 / 桶策略 deny / 输出 / 变量化 / **不硬编码 AK/SK**），并检查 `site/index.html` 是否存在。当前 13/13 全部通过。

## 目录结构

```
iac-static-site/
├─ terraform/
│  ├─ main.tf                   # 全部资源声明
│  └─ terraform.tfvars.example
├─ site/                        # 待部署的静态站
│  ├─ index.html
│  ├─ style.css
│  └─ error.html
├─ scripts/check-iac.mjs        # 无 Terraform 时的结构校验
└─ .env.example                 # 凭证说明（AK/SK 只走环境变量）
```

## 几个实现取舍

- **凭证不进代码**：只用 `HUAWEICLOUD_SDK_AK/SK` 环境变量；`check-iac.mjs` 里专门有一条「不硬编码 AK/SK」的检查。
- **幂等**：对象 ETag 用 `filemd5(...)`，内容没变不会重复上传；新增文件自动进 `for_each`。
- **可选资源用 `count`**：防盗链与 IP 黑名单默认不创建，避免给空名单也生成一个"空策略"。
- **版本控制开启**：静态站本身不需要，但误删可恢复，成本可控。

## 清理

```bash
cd terraform && terraform destroy -var="bucket_name=my-ict-site-2026"
```
