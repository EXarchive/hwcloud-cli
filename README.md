# 基于 IaC 工程化的 Web 服务部署与代码归档

一条 `terraform apply` 把「网络 → 归档桶 → 计算实例 → 启动应用」整条链路交付完，并让**每次发布的代码都留档可追溯**。

## 链路

```
app/ ──pack-release.mjs──▶ dist/app.zip（含 MD5）
                              │
                              ▼
                    OBS 归档桶 releases/app.zip（私有 + 版本控制）
                              │  实例启动时按 RELEASE_URL 拉取
                              ▼
              ECS（user_data 解压 + 启动，端口由 app_port 控制）
                              │
                              ▼
                    output.app_endpoints
```

## 关键设计

| 点 | 做法 | 为什么 |
|----|------|--------|
| **代码归档** | 发布包上传到私有 OBS 桶，桶开版本控制 | 每次发布都有历史版本，回滚只需指向旧版本 |
| **版本可校验** | `etag = filemd5(var.release_zip)` | 内容变了才重新上传；输出 `release_etag` 可直接与本地 MD5 比对 |
| **启动即部署** | `user_data` 里 `curl` 拉包 → `unzip` → `nohup` 启动 | 实例重建即回到一致状态，不依赖人工登录 |
| **端口显式** | `app_port` 变量同时驱动安全组与 `user_data` | 避免「改了端口忘了改安全组」这类事故 |
| **凭证不入库** | AK/SK 只走环境变量，`admin_pass` 标 `sensitive` | 代码可公开，密钥不进 Git |

## 快速开始

```bash
export HUAWEICLOUD_SDK_AK=...
export HUAWEICLOUD_SDK_SK=...

# 1. 打包发布物（零依赖，自带 ZIP 实现）
node scripts/pack-release.mjs
# #zip=dist/app.zip  #files=1  #bytes=409  #md5=6cfacd0a...

# 2. 结构自检（没有 Terraform 也能跑）
node scripts/check-iac.mjs

# 3. 部署
cd terraform
terraform init
terraform apply -var="archive_bucket=my-ict-archive-2026"
```

输出：

```
archive_bucket = "my-ict-archive-2026"
release_object = "releases/app.zip"
release_etag   = "6cfacd0ae9e8261d6cfe1c014d54189c"
app_endpoints  = ["http://192.168.1.x:8080/"]
```

## 打包器说明

`scripts/pack-release.mjs` 是手写 ZIP 写入器（`zlib.deflateRawSync` + 自算 CRC32 + 本地头/中央目录/结束记录），**不依赖任何第三方包**。实测产出的 `dist/app.zip` 可被 .NET `ZipFile` 正常打开：

```
index.html (306 bytes)
```

## 目录结构

```
iac-web-deploy/
├─ terraform/main.tf            # 网络 + 归档桶 + 实例 + 启动脚本
├─ scripts/pack-release.mjs     # 零依赖 ZIP 打包（输出 MD5）
├─ scripts/check-iac.mjs        # 11 项结构校验
├─ app/index.html               # 示例应用
└─ dist/app.zip                 # 打包产物
```

## 清理

```bash
cd terraform && terraform destroy -var="archive_bucket=my-ict-archive-2026"
```

> 归档桶默认开版本控制，销毁前如只想删实例保留归档，可 `terraform destroy -target=huaweicloud_compute_instance.this`。
