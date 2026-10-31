terraform {
  required_version = ">= 1.5.0"

  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = "~> 1.60"
    }
  }

  # 状态文件建议放远端（本地演示用本地后端）
  backend "local" {}
}

provider "huaweicloud" {
  region = var.region
  # 凭证来自环境变量 HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK，
  # 不在代码里出现（见 .env.example）
}

# ---------------------------------------------------------------- 变量
variable "region" {
  description = "区域，静态站建议选离用户近的区域"
  type        = string
  default     = "cn-north-4"
}

variable "bucket_name" {
  description = "OBS 桶名（全局唯一，建议带账号/项目前缀）"
  type        = string
}

variable "site_dir" {
  description = "待上传的静态站根目录"
  type        = string
  default     = "../site"
}

variable "index_document" {
  description = "默认首页"
  type        = string
  default     = "index.html"
}

variable "error_document" {
  description = "错误页"
  type        = string
  default     = "error.html"
}

variable "allow_public_read" {
  description = "是否允许匿名只读访问（静态站必须为 true 才能公网访问）"
  type        = bool
  default     = true
}

variable "allowed_referers" {
  description = "防盗链白名单；空列表表示不限制来源"
  type        = list(string)
  default     = []
}

variable "ip_blacklist" {
  description = "拒绝访问的 IP/CIDR 列表（接桶策略 deny）"
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------- 桶
resource "huaweicloud_obs_bucket" "site" {
  bucket = var.bucket_name
  acl    = var.allow_public_read ? "public-read" : "private"
  # 静态站不需要版本控制，但开启后误删可恢复；演示保留开启
  versioning = true

  website {
    index_document = var.index_document
    error_document = var.error_document
  }

  tags = {
    managed_by = "terraform"
    purpose    = "static-website"
  }
}

# ---------------------------------------------------------------- 对象上传
locals {
  content_types = {
    html = "text/html; charset=utf-8"
    htm  = "text/html; charset=utf-8"
    css  = "text/css; charset=utf-8"
    js   = "application/javascript; charset=utf-8"
    json = "application/json; charset=utf-8"
    svg  = "image/svg+xml"
    png  = "image/png"
    jpg  = "image/jpeg"
    jpeg = "image/jpeg"
    ico  = "image/x-icon"
    webp = "image/webp"
    txt  = "text/plain; charset=utf-8"
  }

  site_files = fileset(var.site_dir, "**")
}

resource "huaweicloud_obs_bucket_object" "files" {
  for_each = local.site_files

  bucket       = huaweicloud_obs_bucket.site.bucket
  key          = each.value
  source       = "${var.site_dir}/${each.value}"
  content_type = lookup(local.content_types, lower(regex("[^.]+$", each.value)), "application/octet-stream")
  etag         = filemd5("${var.site_dir}/${each.value}")
}

# ---------------------------------------------------------------- 访问控制：防盗链
resource "huaweicloud_obs_bucket_referer" "this" {
  count = length(var.allowed_referers) > 0 ? 1 : 0

  bucket   = huaweicloud_obs_bucket.site.bucket
  referers = var.allowed_referers
}

# ---------------------------------------------------------------- 访问控制：桶策略（IP 黑名单 deny）
data "huaweicloud_obs_bucket_policy" "existing" {
  bucket = huaweicloud_obs_bucket.site.bucket
}

resource "huaweicloud_obs_bucket_policy" "deny_ip" {
  count  = length(var.ip_blacklist) > 0 ? 1 : 0
  bucket = huaweicloud_obs_bucket.site.bucket

  policy = jsonencode({
    Version = "1.1"
    Statement = [
      {
        Sid       = "DenyBlacklistedIps"
        Effect    = "Deny"
        Principal = { ID = ["*"] }
        Action    = ["GetObject", "ListBucket"]
        Resource  = ["${huaweicloud_obs_bucket.site.bucket}/*", huaweicloud_obs_bucket.site.bucket]
        Condition = {
          IpAddress = { "SourceIp" = var.ip_blacklist }
        }
      }
    ]
  })
}

# ---------------------------------------------------------------- 输出
output "bucket" {
  value       = huaweicloud_obs_bucket.site.bucket
  description = "桶名"
}

output "website_endpoint" {
  value       = "http://${huaweicloud_obs_bucket.site.bucket}.obs-website.${var.region}.myhuaweicloud.com"
  description = "静态网站访问地址"
}

output "object_count" {
  value       = length(local.site_files)
  description = "已上传对象数"
}

output "access_control" {
  value = {
    public_read     = var.allow_public_read
    referer_limited = length(var.allowed_referers) > 0
    ip_denied       = length(var.ip_blacklist)
  }
  description = "访问控制生效情况"
}
