#!/usr/bin/env node
// run-demo.mjs —— 校园活动策划多智能体协作演示（确定性假 agent）
//
// 用法: node src/run-demo.mjs [--scenario scenarios/campus.json] [--fail review] [--concurrency 3]

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

const scenario = JSON.parse(readFileSync(resolve(ROOT, getArg('scenario', 'scenarios/campus.json')), 'utf8'))
const failTask = getArg('fail', '')
const concurrency = Number(getArg('concurrency', '3'))

// 确定性假 agent：每个任务的产出都是策划案里真正需要的字段
const RESPONSES = {
  concept: () => ({
    theme: 'AI 文化节 · 让算法看得见',
    audience: '全校本科生（预计 400 人）',
    segments: ['AI 画展（人机共创）', '模型对战擂台（猜谁生成的）', 'Prompt 工作坊（现场出图）'],
    timeline: ['14:00 开场', '14:20 画展自由参观', '15:30 擂台赛', '17:00 工作坊', '18:30 收尾'],
  }),
  site: () => ({
    venue_type: '图书馆一层中庭（室内、有电源、可容纳 300 人）',
    equipment: ['投影 ×2', '音响 ×1', '无线麦 ×4', '插排 ×10', '展示架 ×12'],
    supplies: ['展板 12 块', '打印图卡 200 张', '签到台物料 1 套', '矿泉水 4 箱'],
  }),
  budget: () => ({
    items: { 场地: 0, 设备租赁: 1200, 物料印刷: 1800, 宣传: 600, 茶歇: 800 },
    total: 4400,
    contingency: 440,
    note: '场地由学校免费提供，已按 10% 留应急金',
  }),
  promo: () => ({
    slogan: '这一次，让算法站在聚光灯下',
    posts: ['预告：三天后见', '倒计时：参展作品抢先看', '回顾：现场出图精选'],
    schedule: ['T-7 预告', 'T-3 倒计时', 'T-1 提醒', 'T+1 回顾'],
  }),
  review: () => ({
    risks: ['室内使用大功率音响需报备用电容量', '现场拍照涉及肖像权', '擂台赛设备可能被随意插拔'],
    fixes: ['提前 3 天向后勤提交用电申请', '签到台放肖像授权说明并可勾选退出', '设备区拉隔离带并设专人看管'],
    approval_checklist: ['场地借用单', '用电申请', '活动安全承诺书', '宣传物料审核'],
  }),
  rundown: () => ({
    roles_on_site: ['总控 1', '签到 2', '设备 2', '展区讲解 3', '擂台主持 1', '机动 2'],
    rundown: ['13:00 布场', '13:50 设备联调', '14:00 开场', '15:30 擂台', '17:00 工作坊', '18:30 撤场'],
  }),
}

const execute = async (task, ctx) => {
  await new Promise((r) => setTimeout(r, 50 + Math.random() * 70))
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
  console.log('\n=== 策划案要点 ===')
  for (const [id, r] of Object.entries(results)) {
    if (r.status !== 'done') {
      console.log(`${id.padEnd(8)} ${r.status}: ${r.error}`)
      continue
    }
    console.log(`${id.padEnd(8)} ${JSON.stringify(r.output).slice(0, 120)}…`)
  }
  console.log(`\n汇总：成功 ${summary.done} / 失败 ${summary.failed} / 跳过 ${summary.skipped}，耗时 ${summary.durationMs}ms`)
}

main().catch((err) => {
  console.error(`❌ ${err.message}`)
  process.exit(1)
})
