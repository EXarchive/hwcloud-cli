#!/usr/bin/env node
// tests/orchestrator.test.mjs —— 编排内核单测（注入确定性假 agent，不依赖大模型）
import test from 'node:test'
import assert from 'node:assert/strict'
import { TeamError, formatTranscript, runScenario, topoOrder, validateScenario } from '../src/orchestrator.mjs'

const baseScenario = () => ({
  name: 'test',
  roles: [{ name: 'a' }, { name: 'b' }],
  tasks: [
    { id: 't1', role: 'a' },
    { id: 't2', role: 'b', deps: ['t1'] },
    { id: 't3', role: 'a', deps: ['t2'] },
  ],
})

test('validateScenario 通过合法场景', () => {
  assert.equal(validateScenario(baseScenario()), true)
})

test('validateScenario 拒绝重复 role / 未知 role / 未知依赖', () => {
  const dupRole = baseScenario()
  dupRole.roles.push({ name: 'a' })
  assert.throws(() => validateScenario(dupRole), (e) => e.code === 'DUPLICATE_ROLE')

  const unknownRole = baseScenario()
  unknownRole.tasks[0].role = 'zzz'
  assert.throws(() => validateScenario(unknownRole), (e) => e.code === 'UNKNOWN_ROLE')

  const unknownDep = baseScenario()
  unknownDep.tasks[1].deps = ['nope']
  assert.throws(() => validateScenario(unknownDep), (e) => e.code === 'UNKNOWN_DEP')
})

test('validateScenario 拒绝自依赖与环', () => {
  const selfDep = baseScenario()
  selfDep.tasks[0].deps = ['t1']
  assert.throws(() => validateScenario(selfDep), (e) => e.code === 'SELF_DEP')

  const cyclic = {
    name: 'c',
    roles: [{ name: 'a' }],
    tasks: [
      { id: 'x', role: 'a', deps: ['y'] },
      { id: 'y', role: 'a', deps: ['x'] },
    ],
  }
  assert.throws(() => validateScenario(cyclic), (e) => e.code === 'CYCLE')
})

test('topoOrder 保证依赖在前', () => {
  const order = topoOrder(baseScenario().tasks).map((t) => t.id)
  assert.deepEqual(order, ['t1', 't2', 't3'])
})

test('runScenario 按依赖顺序执行并汇总', async () => {
  const seen = []
  const { summary, results } = await runScenario(baseScenario(), {
    execute: async (task) => {
      seen.push(task.id)
      return `${task.id}-out`
    },
    maxConcurrency: 1,
  })
  assert.deepEqual(seen, ['t1', 't2', 't3'])
  assert.equal(summary.done, 3)
  assert.equal(summary.failed, 0)
  assert.equal(results.t3.output, 't3-out')
})

test('runScenario 会把上游产出注入 ctx.upstream', async () => {
  let captured = null
  await runScenario(baseScenario(), {
    execute: async (task, ctx) => {
      if (task.id === 't2') captured = ctx.upstream
      return task.id
    },
    maxConcurrency: 1,
  })
  assert.deepEqual(captured, { t1: 't1' })
})

test('runScenario 失败重试到上限后标记 failed，下游跳过', async () => {
  const calls = { t2: 0 }
  const { summary, results, transcript } = await runScenario(baseScenario(), {
    execute: async (task) => {
      if (task.id === 't2') {
        calls.t2++
        throw new Error('boom')
      }
      return task.id
    },
    attempts: 3,
    maxConcurrency: 1,
  })
  assert.equal(calls.t2, 3, '应按 attempts 重试 3 次')
  assert.equal(results.t2.status, 'failed')
  assert.equal(results.t3.status, 'skipped')
  assert.equal(summary.failed, 1)
  assert.equal(summary.skipped, 1)
  assert.ok(transcript.some((e) => e.type === 'task_retry'))
})

test('runScenario 超时按失败处理', async () => {
  const { results } = await runScenario(
    { name: 't', roles: [{ name: 'a' }], tasks: [{ id: 'slow', role: 'a' }] },
    { execute: () => new Promise((r) => setTimeout(r, 200)), timeoutMs: 30, attempts: 1 },
  )
  assert.equal(results.slow.status, 'failed')
  assert.match(results.slow.error, /超时/)
})

test('runScenario 并发不超过 maxConcurrency', async () => {
  let active = 0
  let peak = 0
  const tasks = [1, 2, 3, 4, 5, 6].map((i) => ({ id: `p${i}`, role: 'a' }))
  await runScenario(
    { name: 'par', roles: [{ name: 'a' }], tasks },
    {
      maxConcurrency: 3,
      execute: async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((r) => setTimeout(r, 20))
        active--
        return 'ok'
      },
    },
  )
  assert.ok(peak <= 3, `并发峰值 ${peak} 超过限制`)
  assert.ok(peak >= 2, '应确实并发执行')
})

test('formatTranscript 输出可读日志', () => {
  const text = formatTranscript([
    { at: 10, type: 'task_done', task: 't1', role: 'a', attempt: 1, durationMs: 10 },
    { at: 20, type: 'run_finished', total: 1, done: 1, failed: 0, skipped: 0, durationMs: 20 },
  ])
  assert.match(text, /✔ t1 \(a\)/)
  assert.match(text, /■ 结束/)
})

test('缺少 execute 抛错', async () => {
  await assert.rejects(() => runScenario(baseScenario(), {}), (e) => e instanceof TeamError)
})
