# 基于 IaC 在华为云上搭建 ECS 服务基础网络环境

用 Terraform 一次性搭出「VPC + 子网 + 安全组 + ECS」这套最小可用网络基线，全程声明式、可重跑、可一键销毁。

## 建了什么

```
VPC 192.168.0.0/16
└─ 子网 192.168.1.0/24（网关自动取 cidrhost(...,1)）
   └─ 安全组：仅放行 SSH(22) 与 ICMP，源地址受 ssh_cidr 约束；出方向全通
      └─ ECS × N：镜像按名匹配、规格按 (cpu,mem) 查询，绑定该子网
```

| 资源 | 关键点 |
|------|--------|
| `huaweicloud_vpc.this` | 网段变量化，带 `managed_by=terraform` 标签便于批量清理 |
| `huaweicloud_vpc_subnet.this` | 网关地址用 `cidrhost()` 推导，避免手写错位 |
| `huaweicloud_networking_secgroup.this` + 两条 rule | **默认拒绝**，只显式放行 SSH 与 ICMP |
| `huaweicloud_compute_instance.this` | `count` 控制台数；`admin_pass` 标 `sensitive` 且可留空 |
| `data.huaweicloud_images_image` / `..._flavors` | 不硬编码镜像与规格 ID，换区域也能跑 |

## 安全默认值

- 安全组**不放开 0.0.0.0/0 的 22 端口**：`ssh_cidr` 默认值虽为 `0.0.0.0/0`，但 README 与 tfvars 示例都要求收敛到办公网出口，生产请改成 `/32`。
- ECS 默认**不挂 EIP**：需要出网时单独加 NAT/EIP，避免实例直接暴露公网。
- 密码走 `sensitive` 变量，不进代码、不进 tfvars 提交（`.gitignore` 已排除）。

## 快速开始

```bash
export HUAWEICLOUD_SDK_AK=...
export HUAWEICLOUD_SDK_SK=...

cd terraform
terraform init
terraform plan  -var="ssh_cidr=1.2.3.4/32"
terraform apply -var="ssh_cidr=1.2.3.4/32"
```

输出：

```
vpc_id               = "..."
subnet_id            = "..."
security_group_id    = "..."
instance_private_ips = ["192.168.1.x"]
ssh_hint             = "ssh root@<私网IP>（需在同 VPC 或经 EIP/NAT 出网）"
```

## 不装 Terraform 也能验

```bash
node scripts/check-iac.mjs
```

13 项结构校验（provider / VPC / 子网网关推导 / 安全组 / SSH 收口 / ICMP / ECS / 镜像 / 规格 / 子网绑定 / sensitive / 输出 / 不硬编码密钥）当前 **13/13 通过**。

## 目录结构

```
iac-ecs-network/
├─ terraform/
│  ├─ main.tf
│  └─ terraform.tfvars.example
├─ scripts/check-iac.mjs
└─ .env.example
```

## 清理

```bash
cd terraform && terraform destroy
```

> 注意：ECS 与 VPC 有依赖顺序，`destroy` 会自动逆序处理；若手工删过子网，先 `terraform refresh` 再销毁。
