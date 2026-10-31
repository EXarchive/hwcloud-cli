terraform {
  required_version = ">= 1.5.0"
  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = "~> 1.60"
    }
  }
  backend "local" {}
}

provider "huaweicloud" {
  region = var.region
}

# ================================================================
# IaC 工程化的 Web 服务部署 + 代码归档
#   网络基线 → 归档桶（存发布包）→ 计算实例（拉包启动）→ 输出访问入口
# ================================================================

variable "region" {
  type    = string
  default = "cn-north-4"
}

variable "name_prefix" {
  type    = string
  default = "ict-web"
}

variable "vpc_cidr" {
  type    = string
  default = "192.168.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "192.168.1.0/24"
}

variable "archive_bucket" {
  description = "存放发布包（zip）的 OBS 桶，全局唯一"
  type        = string
}

variable "release_zip" {
  description = "本地待归档的发布包路径"
  type        = string
  default     = "../dist/app.zip"
}

variable "app_port" {
  description = "应用监听端口"
  type        = number
  default     = 8080
}

variable "http_cidr" {
  description = "允许访问应用端口的源网段"
  type        = string
  default     = "0.0.0.0/0"
}

variable "instance_count" {
  type    = number
  default = 1
}

variable "admin_password" {
  type      = string
  sensitive = true
  default   = ""
}

# ---------------------------------------------------------------- 网络
resource "huaweicloud_vpc" "this" {
  name = "${var.name_prefix}-vpc"
  cidr = var.vpc_cidr
}

resource "huaweicloud_vpc_subnet" "this" {
  name       = "${var.name_prefix}-subnet"
  cidr       = var.subnet_cidr
  gateway_ip = cidrhost(var.subnet_cidr, 1)
  vpc_id     = huaweicloud_vpc.this.id
}

resource "huaweicloud_networking_secgroup" "web" {
  name        = "${var.name_prefix}-sg"
  description = "web service security group"
}

resource "huaweicloud_networking_secgroup_rule" "http" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = var.app_port
  port_range_max    = var.app_port
  remote_ip_prefix  = var.http_cidr
  security_group_id = huaweicloud_networking_secgroup.web.id
  description       = "app port"
}

resource "huaweicloud_networking_secgroup_rule" "ssh" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = var.http_cidr
  security_group_id = huaweicloud_networking_secgroup.web.id
  description       = "ssh"
}

# ---------------------------------------------------------------- 代码归档桶
resource "huaweicloud_obs_bucket" "archive" {
  bucket     = var.archive_bucket
  acl        = "private"
  versioning = true
  tags       = { managed_by = "terraform", purpose = "release-archive" }
}

resource "huaweicloud_obs_bucket_object" "release" {
  bucket       = huaweicloud_obs_bucket.archive.bucket
  key          = "releases/app.zip"
  source       = var.release_zip
  content_type = "application/zip"
  etag         = filemd5(var.release_zip)
}

# ---------------------------------------------------------------- 计算实例（启动时拉包）
data "huaweicloud_images_image" "ubuntu" {
  name        = "Ubuntu 22.04 server 64bit"
  most_recent = true
}

data "huaweicloud_compute_flavors" "this" {
  performance_type = "normal"
  cpu_core_count   = 1
  memory_size      = 2
}

locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euo pipefail
    exec > /var/log/app-bootstrap.log 2>&1

    APP_DIR=/opt/app
    mkdir -p "$APP_DIR"
    cd "$APP_DIR"

    # 从归档桶拉取发布包（实例需具备 OBS 只读权限，或使用临时 URL）
    if [ -n "$${RELEASE_URL:-}" ]; then
      curl -fsSL "$${RELEASE_URL}" -o app.zip
      unzip -o app.zip -d "$APP_DIR"
    fi

    # 启动应用（此处以静态服务为例，替换为实际启动命令）
    nohup python3 -m http.server ${var.app_port} --directory "$APP_DIR" > /var/log/app.log 2>&1 &

    echo "bootstrap done at $(date -Is)"
  EOT
}

resource "huaweicloud_compute_instance" "this" {
  count = var.instance_count

  name              = "${var.name_prefix}-app-${count.index + 1}"
  image_id          = data.huaweicloud_images_image.ubuntu.id
  flavor_id         = data.huaweicloud_compute_flavors.this.ids[0]
  security_groups   = [huaweicloud_networking_secgroup.web.name]
  admin_pass        = var.admin_password != "" ? var.admin_password : null
  user_data         = local.user_data

  network {
    uuid = huaweicloud_vpc_subnet.this.id
  }

  tags = { managed_by = "terraform", role = "web" }
}

# ---------------------------------------------------------------- 输出
output "archive_bucket" {
  value = huaweicloud_obs_bucket.archive.bucket
}

output "release_object" {
  value = huaweicloud_obs_bucket_object.release.key
}

output "release_etag" {
  value       = huaweicloud_obs_bucket_object.release.etag
  description = "发布包 MD5，可用于校验部署版本"
}

output "app_endpoints" {
  value       = [for ip in huaweicloud_compute_instance.this[*].access_ip_v4 : "http://${ip}:${var.app_port}/"]
  description = "应用访问地址（私网；公网需另挂 EIP/NAT）"
}

output "instance_ids" {
  value = huaweicloud_compute_instance.this[*].id
}
