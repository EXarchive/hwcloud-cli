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

# ---------------------------------------------------------------- 变量
variable "region" {
  description = "区域"
  type        = string
  default     = "cn-north-4"
}

variable "name_prefix" {
  description = "资源名前缀，便于识别与批量清理"
  type        = string
  default     = "ict-net"
}

variable "vpc_cidr" {
  description = "VPC 网段"
  type        = string
  default     = "192.168.0.0/16"
}

variable "subnet_cidr" {
  description = "子网网段（须在 VPC 内）"
  type        = string
  default     = "192.168.1.0/24"
}

variable "availability_zone" {
  description = "可用区，留空则由 provider 选"
  type        = string
  default     = ""
}

variable "ssh_cidr" {
  description = "允许 SSH 的源网段；生产建议收敛到堡垒机/办公网出口"
  type        = string
  default     = "0.0.0.0/0"
}

variable "instance_flavor" {
  description = "ECS 规格"
  type        = string
  default     = "s6.small.1"
}

variable "instance_image_name" {
  description = "ECS 镜像（按名称模糊匹配）"
  type        = string
  default     = "Ubuntu 22.04 server 64bit"
}

variable "instance_count" {
  description = "ECS 数量"
  type        = number
  default     = 1
}

variable "admin_password" {
  description = "ECS 初始密码（建议改用密钥对）"
  type        = string
  sensitive   = true
  default     = ""
}

# ---------------------------------------------------------------- 网络
resource "huaweicloud_vpc" "this" {
  name = "${var.name_prefix}-vpc"
  cidr = var.vpc_cidr
  tags = { managed_by = "terraform" }
}

resource "huaweicloud_vpc_subnet" "this" {
  name       = "${var.name_prefix}-subnet"
  cidr       = var.subnet_cidr
  gateway_ip = cidrhost(var.subnet_cidr, 1)
  vpc_id     = huaweicloud_vpc.this.id
  tags       = { managed_by = "terraform" }
}

# 安全组：默认只放行 SSH 与 ICMP，出方向全通
resource "huaweicloud_networking_secgroup" "this" {
  name        = "${var.name_prefix}-sg"
  description = "ICT IaC demo security group"
}

resource "huaweicloud_networking_secgroup_rule" "ssh" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "tcp"
  port_range_min    = 22
  port_range_max    = 22
  remote_ip_prefix  = var.ssh_cidr
  security_group_id = huaweicloud_networking_secgroup.this.id
  description       = "SSH from allowed CIDR"
}

resource "huaweicloud_networking_secgroup_rule" "icmp" {
  direction         = "ingress"
  ethertype         = "IPv4"
  protocol          = "icmp"
  remote_ip_prefix  = var.ssh_cidr
  security_group_id = huaweicloud_networking_secgroup.this.id
  description       = "Ping from allowed CIDR"
}

# ---------------------------------------------------------------- ECS
data "huaweicloud_images_image" "ubuntu" {
  name        = var.instance_image_name
  most_recent = true
}

data "huaweicloud_compute_flavors" "this" {
  availability_zone = var.availability_zone != "" ? var.availability_zone : null
  performance_type  = "normal"
  cpu_core_count    = 1
  memory_size       = 2
}

resource "huaweicloud_compute_instance" "this" {
  count = var.instance_count

  name               = "${var.name_prefix}-ecs-${count.index + 1}"
  image_id           = data.huaweicloud_images_image.ubuntu.id
  flavor_id          = data.huaweicloud_compute_flavors.this.ids[0]
  security_groups    = [huaweicloud_networking_secgroup.this.name]
  availability_zone  = var.availability_zone != "" ? var.availability_zone : null
  admin_pass         = var.admin_password != "" ? var.admin_password : null

  network {
    uuid = huaweicloud_vpc_subnet.this.id
  }

  tags = { managed_by = "terraform" }
}

# ---------------------------------------------------------------- 输出
output "vpc_id" {
  value = huaweicloud_vpc.this.id
}

output "subnet_id" {
  value = huaweicloud_vpc_subnet.this.id
}

output "security_group_id" {
  value = huaweicloud_networking_secgroup.this.id
}

output "instance_private_ips" {
  value       = huaweicloud_compute_instance.this[*].access_ip_v4
  description = "ECS 私网 IP 列表"
}

output "instance_ids" {
  value = huaweicloud_compute_instance.this[*].id
}

output "ssh_hint" {
  value       = "ssh root@<私网IP>（需在同 VPC 或经 EIP/NAT 出网）"
  description = "登录提示"
}
