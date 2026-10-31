#!/usr/bin/env node
// run-demo.mjs —— 多 Agent 面试协同演示（确定性假 agent）
//
// 用法: node src/run-demo.mjs [--scenario scenarios/interview.json] [--fail tech] [--concurrency 3]

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

const scenario = JSON.parse(readFileSync(resolve(ROOT, getArg('scenario', 'scenarios/interview.json')), 'utf8'))
const failTask = getArg('fail', '')
const concurrency = Number(getArg('concurrency', '3'))

const RESPONSES = {
  resume: () => ({
    skills: ['TypeScript', 'Node.js', 'MySQL', 'Kubernetes（自述）'],
    projects: ['校园二手交易平台', '社团活动报名系统'],
    verify_points: ['K8s 是否真在生产用过', '平台的并发量级与你的具体职责'],
  }),
  tech: () => ({
    questions: ['事件循环与微任务顺序', '索引失效的常见场景', '进程与线程区别', '手写防抖', 'HTTP 缓存策略'],
    score: 3.8,
    evidence: '基础扎实，手写题思路对但边界处理不完整',
  }),
  project: () => ({
    questions: ['项目最难的一次线上故障怎么定位', '为什么选这套技术栈', '如果重做会怎么改'],
    score: 4.2,
    contribution: '核心后端与部署确实由本人主导，能说清取舍',
  }),
  hr: () => ({
    questions: ['为什么想换方向', '和队友意见冲突怎么处理', '未来两年的规划'],
    score: 3.5,
    risks: ['对运维方向的动机偏弱，更像「被安排」'],
  }),
  calibrate: (ctx) => {
    const scores = [ctx.upstream.tech.score, ctx.upstream.project.score, ctx.upstream.hr.score]
    const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    const variance = Math.round((Math.max(...scores) - Math.min(...scores)) * 100) / 100
    return {
      variance,
      final_score: avg,
      decision: avg >= 4 ? '强烈推荐' : avg >= 3.5 ? '推荐' : '待定',
      note: `三面分歧 ${variance} 分，主要来自 HR 面对动机的判断低于技术面`,
    }
  },
  report: (ctx) => ({
    conclusion: ctx.upstream.calibrate.decision,
    evidence: ['技术面 3.8', '项目面 4.2', 'HR 面 3.5', `校准后方差 ${ctx.upstream.calibrate.variance}`],
    improvements: ['补一次 K8s 生产实践的具体追问', '把动机问题留给用人经理复面'],
  }),
}

const execute = async (task, ctx) => {
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 60))
  if (failTask && task.id === failTask) throw new Error(`模拟失败：${task.id}`)
  const fn = RESPONSES[task.id]
  return fn ? fn(ctx) : { note: 'ok' }
}

const main = async () => {
  console.log(`场景：${scenario.name}`)
  console.log(`角色：${scenario.roles.map((r) => `${r.title}(${r.name})`).join(' / ')}`)
  console.log(`任务：${scenario.tasks.length} 个，最大并发 ${concurrency}\n`)

  const { summary, results, transcript } = await runScenario(scenario, {
    execute,
    maxConcurrency: concurrency,
    attempts: 2,
  })

  console.log(formatTranscript(transcript))
  console.log('\n=== 各面结论 ===')
  for (const [id, r] of Object.entries(results)) {
    if (r.status !== 'done') {
      console.log(`${id.padEnd(10)} ${r.status}: ${r.error}`)
      continue
    }
    const score = r.output.score ?? r.output.final_score
    console.log(`${id.padEnd(10)} 分数 ${score ?? '-'}  ${JSON.stringify(r.output).slice(0, 100)}…`)
  }
  console.log(`\n汇总：成功 ${summary.done} / 失败 ${summary.failed} / 跳过 ${summary.skipped}，耗时 ${summary.durationMs}ms`)
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  process.exit(1)
})
