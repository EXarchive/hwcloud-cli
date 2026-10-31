#!/usr/bin/env node
// run-demo.mjs —— 用「确定性假 agent」跑一遍毕业设计协作，展示编排、重试、跳过与日志
//
// 用法: node src/run-demo.mjs [--scenario scenarios/graduation.json] [--fail build] [--concurrency 2]

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatTranscript, runScenario } from './orchestrator.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const getArg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const scenarioPath = resolve(ROOT, getArg('scenario', 'scenarios/graduation.json'))
const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'))
const failTask = getArg('fail', '')
const concurrency = Number(getArg('concurrency', '2'))

// 假 agent：按角色生成结构化产出，模拟真实耗时；--fail 指定任务恒定失败以演示跳过链路
const RESPONSES = {
  topic: () => ({
    topics: [
      '基于多智能体协作的毕业设计过程管理平台',
      '面向校园场景的轻量知识库问答系统',
      '可解释的代码提交质量评估工具',
    ],
    recommended: '基于多智能体协作的毕业设计过程管理平台',
  }),
  survey: (ctx) => ({
    status_quo: `围绕「${ctx.upstream.topic.recommended}」，现有工作多聚焦单点工具，缺少过程协同。`,
    gap: '缺少把角色分工、任务依赖与交付物验收打通的开源编排实现。',
  }),
  design: () => ({
    architecture: ['前端看板', '编排内核', '角色执行器', '交付物仓库'],
    milestones: ['M1 需求与原型', 'M2 编排内核', 'M3 角色接入', 'M4 验收与答辩材料'],
  }),
  build: () => ({
    code: 'orchestrator.mjs（拓扑调度 + 重试 + 跳过）',
    runbook: 'node src/run-demo.mjs',
  }),
  review: () => ({
    score: { innovation: 4, feasibility: 5, workload: 4 },
    issues: ['需要补充并发压测', '交付物验收标准要量化'],
  }),
  report: (ctx) => ({
    outline: [
      '研究背景与问题',
      `研究现状（${ctx.upstream.survey.gap}）`,
      '系统设计',
      '关键实现',
      '评测与改进',
    ],
  }),
}

const execute = async (task) => {
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 80))
  if (failTask && task.id === failTask) throw new Error(`模拟失败：${task.id}`)
  const fn = RESPONSES[task.id] ?? (() => ({ note: 'ok' }))
  return fn({ upstream: {} })
}

const main = async () => {
  console.log(`场景：${scenario.name}`)
  console.log(`角色：${scenario.roles.map((r) => `${r.title}(${r.name})`).join(' / ')}`)
  console.log(`任务：${scenario.tasks.length} 个，最大并发 ${concurrency}\n`)

  // 第二次包装：把上游结果注入（execute 内部拿到 ctx.upstream）
  const executeWithContext = async (task, ctx) => {
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 80))
    if (failTask && task.id === failTask) throw new Error(`模拟失败：${task.id}`)
    const fn = RESPONSES[task.id] ?? (() => ({ note: 'ok' }))
    return fn(ctx)
  }

  const { summary, results, transcript } = await runScenario(scenario, {
    execute: executeWithContext,
    maxConcurrency: concurrency,
    attempts: 2,
  })

  console.log(formatTranscript(transcript))
  console.log('\n=== 各任务产出 ===')
  for (const [id, r] of Object.entries(results)) {
    const brief = r.status === 'done' ? JSON.stringify(r.output).slice(0, 110) + '…' : `${r.status}: ${r.error}`
    console.log(`${id.padEnd(8)} ${r.status.padEnd(8)} ${brief}`)
  }
  console.log(`\n汇总：${JSON.stringify(summary)}`)
  process.exitCode = summary.failed > 0 ? 0 : 0
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  process.exit(1)
})
