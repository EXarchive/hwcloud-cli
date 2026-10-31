# 多 Agent 面试协同团队

一场技术岗模拟面试，由 **5 个角色** 分工：简历解析 → 三面并行（技术 / 项目 / HR）→ 主席交叉校准 → 出评估报告。

关键点：**三个面试面互不依赖、真并行**，最后由主席处理「三面打分不一致」这个真实痛点。

## 角色与依赖

```
resume ──┬──▶ tech    ──┐
         ├──▶ project ──┼──▶ calibrate ──▶ report
         └──▶ hr      ──┘
```

| 角色 | 产出 |
|------|------|
| `screener` 简历解析官 | 技能栈、项目清单、**需在面试中验证的可疑点** |
| `tech` 技术面试官 | 5 道递进题 + 0-5 分 + 评分证据 |
| `project` 项目面试官 | STARR 追问 + 贡献度判断 |
| `hr` HR 面试官 | 动机/协作/稳定性 + 风险点 |
| `chair` 面试主席 | 三面方差、最终分、录用建议、评估报告 |

## 运行

```bash
node src/run-demo.mjs                    # 正常（并发 3，三面并行）
node src/run-demo.mjs --concurrency 1    # 串行对照，观察耗时差异
node src/run-demo.mjs --fail tech        # 技术面挂了 → 校准与报告被跳过
node --test tests/                       # 编排内核 11 例单测
```

实测输出：

```
+   83ms  ✔ resume (screener) 第1次成功，耗时 83ms
+  145ms  ✔ tech (tech) 第1次成功，耗时 62ms
+  177ms  ✔ hr (hr) 第1次成功，耗时 94ms
+  193ms  ✔ project (project) 第1次成功，耗时 110ms
+  302ms  ✔ calibrate (chair) 第1次成功，耗时 109ms
+  379ms  ✔ report (chair) 第1次成功，耗时 77ms
+  379ms  ■ 结束：共 6，成功 6，失败 0，跳过 0，总耗时 379ms
```

三面在 145~193ms 区间内并行完成：并发的收益直接体现在总耗时上。

## 交叉校准在解决什么

三面独立打分必然出现分歧：本例技术 3.8、项目 4.2、HR 3.5，**方差 0.7**。主席角色的价值不是「求平均」，而是：

1. 量化分歧（`variance`）；
2. 解释分歧来源（HR 对「动机」的判断低于技术/项目面）；
3. 给出结论并把分歧转成后续动作（「把动机问题留给用人经理复面」）。

这样「要不要录用」变成一个可讨论的判断，而不是拍脑袋。

## 失败语义

`--fail tech` 时：

- `tech` 重试到上限 → `failed`
- `calibrate` 依赖 tech/project/hr 三面 → `skipped`
- `report` 依赖 calibrate → `skipped`

即：**缺一面就不出结论**，避免用两面数据硬凑一个「通过」。这比「降级给个平均分」更符合面试场景的严谨性。

## 目录结构

```
agentteam-interview/
├─ src/
│  ├─ orchestrator.mjs     # 编排内核（拓扑 / 并发 / 重试 / 跳过 / 日志）
│  └─ run-demo.mjs         # 面试场景的确定性假 agent
├─ scenarios/interview.json
└─ tests/orchestrator.test.mjs
```

## 接真实模型

```js
const execute = async (task, ctx) => {
  // ctx.role.goal 是面试官的考察目标，ctx.upstream 里已有简历结构化结果
  const reply = await llm.chat({ system: ctx.role.goal, user: task.prompt, context: ctx.upstream })
  return JSON.parse(reply)
}
await runScenario(scenario, { execute, maxConcurrency: 3 })
```
