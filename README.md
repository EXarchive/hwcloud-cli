# 多智能体协作完成毕业设计

一个**可测试的**多智能体编排内核：把「毕业设计」拆成角色 + 任务依赖图，由编排器按拓扑顺序调度、并行执行、失败重试、失败后跳过下游，全过程留可读的协作日志。

核心只有 `src/orchestrator.mjs` 一个文件，**agent 执行函数由外部注入**——所以单测可以注入确定性假 agent，不依赖任何大模型、不烧 token。

## 角色与任务（毕业设计场景）

| 角色 | 职责 |
|------|------|
| `advisor` 选题顾问 | 把模糊兴趣收敛成可做的题目，最后汇总开题报告 |
| `researcher` 文献综述员 | 梳理研究现状与空白点 |
| `architect` 方案设计 | 系统架构 + 技术选型 + 里程碑 |
| `engineer` 实现工程师 | 最小可运行原型的关键代码与运行方式 |
| `reviewer` 评审专家 | 从创新性/可行性/工程量三档评审并给改进项 |

依赖图：

```
topic ──▶ survey ──▶ design ──▶ build ──▶ review ──▶ report
                                     └────────┘        ▲
                        survey ──────────────────────┘
```

## 运行

```bash
node src/run-demo.mjs                        # 正常跑通
node src/run-demo.mjs --concurrency 3        # 调大并发
node src/run-demo.mjs --fail build           # 演示失败重试与下游跳过
node src/run-demo.mjs --scenario scenarios/graduation.json
```

正常输出：

```
+  110ms  ✔ topic (advisor) 第1次成功，耗时 110ms
+  187ms  ✔ survey (researcher) 第1次成功，耗时 77ms
+  311ms  ✔ design (architect) 第1次成功，耗时 124ms
+  420ms  ✔ build (engineer) 第1次成功，耗时 109ms
+  513ms  ✔ review (reviewer) 第1次成功，耗时 93ms
+  624ms  ✔ report (advisor) 第1次成功，耗时 111ms
+  624ms  ■ 结束：共 6，成功 6，失败 0，跳过 0，总耗时 624ms
```

故障输出（`--fail build`）：

```
+  423ms  ↻ build 第1次失败：模拟失败：build
+  533ms  ↻ build 第2次失败：模拟失败：build
+  533ms  ✖ build (engineer) 最终失败：模拟失败：build
+  533ms  ⊘ review 跳过：依赖任务失败
+  533ms  ⊘ report 跳过：无法调度
+  533ms  ■ 结束：共 6，成功 3，失败 1，跳过 2，总耗时 533ms
```

## 编排内核设计

| 机制 | 实现 |
|------|------|
| **场景校验** | 重复 role / 未知 role / 未知依赖 / 自依赖 / 依赖环，全部 fail-fast 并给错误码 |
| **拓扑调度** | Kahn 算法求序；运行期只把「依赖全部 done」的任务入队 |
| **并发控制** | `maxConcurrency` 上限，`Promise.race` 驱动主循环 |
| **失败重试** | 每任务 `attempts` 上限，每次失败记 `task_retry` |
| **失败传播** | 依赖失败 → 下游标 `skipped`（不是 failed），避免误报 |
| **超时保护** | `withTimeout` 包裹，超时按失败处理 |
| **上游注入** | `ctx.upstream` 传入依赖任务的产出，角色不用自己去查 |
| **可观测** | `transcript` 事件流 + `formatTranscript` 渲染成人读日志 |

## 单测（11 例全通过）

```
✔ validateScenario 通过合法场景
✔ validateScenario 拒绝重复 role / 未知 role / 未知依赖
✔ validateScenario 拒绝自依赖与环
✔ topoOrder 保证依赖在前
✔ runScenario 按依赖顺序执行并汇总
✔ runScenario 会把上游产出注入 ctx.upstream
✔ runScenario 失败重试到上限后标记 failed，下游跳过
✔ runScenario 超时按失败处理
✔ runScenario 并发不超过 maxConcurrency
✔ formatTranscript 输出可读日志
✔ 缺少 execute 抛错
tests 11 / pass 11 / fail 0
```

其中「并发不超过 maxConcurrency」是真并发探针：用计数器记录峰值，断言 `peak <= 3` 且 `peak >= 2`。

## 目录结构

```
agentteam-graduation/
├─ src/
│  ├─ orchestrator.mjs   # 编排内核（校验 / 拓扑 / 调度 / 重试 / 跳过 / 日志）
│  └─ run-demo.mjs       # 确定性假 agent + 演示入口
├─ scenarios/graduation.json
└─ tests/orchestrator.test.mjs
```

## 与真实大模型对接

把 `run-demo.mjs` 里的 `executeWithContext` 换成真实调用即可，其余（调度、重试、跳过、并发、日志）完全复用：

```js
const execute = async (task, ctx) => {
  const reply = await llm.chat({
    role: ctx.role.goal,
    messages: [{ role: 'user', content: task.prompt }],
    context: ctx.upstream,
  })
  return { text: reply }
}
await runScenario(scenario, { execute, maxConcurrency: 3 })
```
