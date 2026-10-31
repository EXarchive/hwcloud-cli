# 校园活动策划多智能体团队

把「办一场校园活动」拆成 6 个角色 + 一张依赖图，由编排内核按拓扑调度、并发执行、失败重试、失败后跳过下游，最后产出可直接执行的策划案要点。

## 角色分工

| 角色 | 产出 |
|------|------|
| `planner` 活动策划 | 主题、目标人群、三个主环节、时间轴 |
| `venue` 场地与物资 | 场地类型、设备清单、物资清单 |
| `promo` 宣传推广 | 主视觉文案、三条社媒推文、投放节奏 |
| `budget` 预算控制 | 四项预算 + 10% 应急金 |
| `risk` 审批风控 | 风险项、整改项、审批清单 |
| `executor` 现场执行 | 岗位表与当天流程表 |

依赖图（`promo` 与 `site` 并行，`review` 要等预算与宣传都出来）：

```
concept ──┬──▶ site ──▶ budget ──┐
          └──▶ promo ────────────┴──▶ review ──▶ rundown
```

## 运行

```bash
node src/run-demo.mjs                    # 正常跑通（并发 3）
node src/run-demo.mjs --concurrency 1    # 串行对照
node src/run-demo.mjs --fail review      # 审批卡住 → 现场执行被跳过
node --test tests/                       # 编排内核单测（11 例）
```

实测输出：

```
+   73ms  ✔ concept (planner) 第1次成功，耗时 72ms
+  135ms  ✔ site (venue) 第1次成功，耗时 62ms
+  166ms  ✔ promo (promo) 第1次成功，耗时 92ms
+  229ms  ✔ budget (budget) 第1次成功，耗时 94ms
+  291ms  ✔ review (risk) 第1次成功，耗时 62ms
+  385ms  ✔ rundown (executor) 第1次成功，耗时 94ms
+  385ms  ■ 结束：共 6，成功 6，失败 0，跳过 0，总耗时 385ms
```

`site` 与 `promo` 在同一批被调度（都只依赖 `concept`），体现并发收益。

## 为什么这个场景值得做成多 Agent

- **角色之间有真实冲突**：宣传想加量、预算想省钱、风控想加流程。拆成独立角色后，冲突变成显式的「下游依赖 + 评审」，而不是一个人脑子里打架。
- **可并行**：场地与宣传互不依赖，天然并发。
- **失败要能局部止损**：审批没过就不该继续排岗位表——编排器把这种情况标成 `skipped` 而不是 `failed`，一眼看出是「被上游拖住」。

## 目录结构

```
agentteam-campus/
├─ src/
│  ├─ orchestrator.mjs   # 编排内核（拓扑 / 并发 / 重试 / 跳过 / 日志）
│  └─ run-demo.mjs       # 校园活动场景的确定性假 agent
├─ scenarios/campus.json # 角色与依赖图定义
└─ tests/orchestrator.test.mjs
```

## 换成真实大模型

```js
const execute = async (task, ctx) => {
  const reply = await llm.chat({
    system: ctx.role.goal,
    user: task.prompt,
    context: ctx.upstream,   // 上游产出自动注入
  })
  return JSON.parse(reply)
}
await runScenario(scenario, { execute, maxConcurrency: 3, attempts: 2 })
```

调度、重试、跳过、日志全部复用，不需要改内核。
