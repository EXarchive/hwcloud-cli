// orchestrator.mjs —— 多智能体协作编排内核
//
// 模型：角色（role）+ 任务（task）+ 依赖（deps）+ 交付物（artifacts）
// 调度：拓扑排序 → 就绪队列 → 并行执行（受 maxConcurrency 限制）→ 汇总
// 保障：每个任务有 attempt 上限与超时；失败不阻塞无关分支；全过程写 transcript
//
// 这是一个「可测的」编排器：agent 执行函数由外部注入（execute），
// 因此单测里可以注入确定性假 agent，不依赖任何大模型。

export class TeamError extends Error {
  constructor(message, code = 'TEAM_ERROR') {
    super(message)
    this.code = code
  }
}

/** 校验场景定义 */
export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') throw new TeamError('场景不能为空')
  const { name, roles, tasks } = scenario
  if (!name) throw new TeamError('场景缺少 name')
  if (!Array.isArray(roles) || roles.length === 0) throw new TeamError('场景缺少 roles')
  if (!Array.isArray(tasks) || tasks.length === 0) throw new TeamError('场景缺少 tasks')

  const roleNames = new Set()
  for (const role of roles) {
    if (!role.name) throw new TeamError('role 缺少 name')
    if (roleNames.has(role.name)) throw new TeamError(`role 重复: ${role.name}`, 'DUPLICATE_ROLE')
    roleNames.add(role.name)
  }

  const taskIds = new Set()
  for (const task of tasks) {
    if (!task.id) throw new TeamError('task 缺少 id')
    if (taskIds.has(task.id)) throw new TeamError(`task 重复: ${task.id}`, 'DUPLICATE_TASK')
    taskIds.add(task.id)
    if (!task.role) throw new TeamError(`task ${task.id} 缺少 role`)
    if (!roleNames.has(task.role)) throw new TeamError(`task ${task.id} 引用了未知 role: ${task.role}`, 'UNKNOWN_ROLE')
  }

  for (const task of tasks) {
    for (const dep of task.deps ?? []) {
      if (!taskIds.has(dep)) throw new TeamError(`task ${task.id} 依赖了不存在的任务: ${dep}`, 'UNKNOWN_DEP')
      if (dep === task.id) throw new TeamError(`task ${task.id} 不能依赖自身`, 'SELF_DEP')
    }
  }

  assertNoCycle(tasks)
  return true
}

/** 拓扑排序 + 环检测（Kahn） */
export function topoOrder(tasks) {
  const indeg = new Map(tasks.map((t) => [t.id, (t.deps ?? []).length]))
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const dependents = new Map(tasks.map((t) => [t.id, []]))
  for (const task of tasks) {
    for (const dep of task.deps ?? []) dependents.get(dep).push(task.id)
  }

  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id)
  const order = []
  while (queue.length > 0) {
    const id = queue.shift()
    order.push(id)
    for (const next of dependents.get(id)) {
      indeg.set(next, indeg.get(next) - 1)
      if (indeg.get(next) === 0) queue.push(next)
    }
  }
  if (order.length !== tasks.length) throw new TeamError('任务依赖存在环', 'CYCLE')
  return order.map((id) => byId.get(id))
}

function assertNoCycle(tasks) {
  topoOrder(tasks)
}

/**
 * 运行一个场景
 * @param {object} scenario 场景定义
 * @param {object} options
 * @param {(task, ctx) => Promise<any>} options.execute 注入的 agent 执行函数
 * @param {number} [options.maxConcurrency=2]
 * @param {number} [options.attempts=2]
 * @param {number} [options.timeoutMs=5000]
 */
export async function runScenario(scenario, options = {}) {
  validateScenario(scenario)
  const { execute, maxConcurrency = 2, attempts = 2, timeoutMs = 5000 } = options
  if (typeof execute !== 'function') throw new TeamError('必须提供 execute 函数')

  const tasks = scenario.tasks
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const results = new Map() // id -> { status, output, error, attempts, durationMs }
  const transcript = []
  const pending = new Set(tasks.map((t) => t.id))
  const running = new Map()
  const startedAt = Date.now()

  const log = (event) => {
    transcript.push({ at: Date.now() - startedAt, ...event })
  }

  const depsDone = (task) => (task.deps ?? []).every((d) => results.get(d)?.status === 'done')

  const depsFailed = (task) => (task.deps ?? []).some((d) => results.get(d)?.status === 'failed')

  async function runTask(task) {
    const began = Date.now()
    let lastError = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const output = await withTimeout(
          Promise.resolve(
            execute(task, {
              scenario,
              role: scenario.roles.find((r) => r.name === task.role),
              upstream: Object.fromEntries((task.deps ?? []).map((d) => [d, results.get(d)?.output])),
            }),
          ),
          timeoutMs,
          `任务 ${task.id} 超时（${timeoutMs}ms）`,
        )
        const record = { status: 'done', output, attempts: attempt, durationMs: Date.now() - began }
        results.set(task.id, record)
        log({ type: 'task_done', task: task.id, role: task.role, attempt, durationMs: record.durationMs })
        return record
      } catch (err) {
        lastError = err
        log({ type: 'task_retry', task: task.id, attempt, message: err.message })
      }
    }
    const record = { status: 'failed', error: lastError?.message ?? 'unknown', attempts, durationMs: Date.now() - began }
    results.set(task.id, record)
    log({ type: 'task_failed', task: task.id, role: task.role, message: record.error })
    return record
  }

  while (pending.size > 0 || running.size > 0) {
    // 依赖失败的任务直接标记 skipped
    for (const id of [...pending]) {
      const task = byId.get(id)
      if (depsFailed(task)) {
        pending.delete(id)
        results.set(id, { status: 'skipped', error: '依赖任务失败', attempts: 0, durationMs: 0 })
        log({ type: 'task_skipped', task: id, reason: '依赖任务失败' })
      }
    }

    // 就绪任务入队（受并发限制）
    while (running.size < maxConcurrency) {
      const ready = [...pending].filter((id) => depsDone(byId.get(id)))
      if (ready.length === 0) break
      const id = ready[0]
      pending.delete(id)
      const promise = runTask(byId.get(id)).finally(() => running.delete(id))
      running.set(id, promise)
    }

    if (running.size === 0) {
      // 没有可运行的也没在跑的：剩下的一定是死锁或依赖失败
      for (const id of [...pending]) {
        results.set(id, { status: 'skipped', error: '无法调度', attempts: 0, durationMs: 0 })
        log({ type: 'task_skipped', task: id, reason: '无法调度' })
        pending.delete(id)
      }
      break
    }
    await Promise.race(running.values())
  }

  const summary = {
    scenario: scenario.name,
    total: tasks.length,
    done: [...results.values()].filter((r) => r.status === 'done').length,
    failed: [...results.values()].filter((r) => r.status === 'failed').length,
    skipped: [...results.values()].filter((r) => r.status === 'skipped').length,
    durationMs: Date.now() - startedAt,
  }
  log({ type: 'run_finished', ...summary })

  return { summary, results: Object.fromEntries(results), transcript }
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TeamError(message, 'TIMEOUT')), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** 把 transcript 渲染成人可读的协作日志 */
export function formatTranscript(transcript) {
  return transcript
    .map((e) => {
      const t = `+${String(e.at).padStart(5)}ms`
      switch (e.type) {
        case 'task_done':
          return `${t}  ✔ ${e.task} (${e.role}) 第${e.attempt}次成功，耗时 ${e.durationMs}ms`
        case 'task_retry':
          return `${t}  ↻ ${e.task} 第${e.attempt}次失败：${e.message}`
        case 'task_failed':
          return `${t}  ✖ ${e.task} (${e.role}) 最终失败：${e.message}`
        case 'task_skipped':
          return `${t}  ⊘ ${e.task} 跳过：${e.reason}`
        case 'run_finished':
          return `${t}  ■ 结束：共 ${e.total}，成功 ${e.done}，失败 ${e.failed}，跳过 ${e.skipped}，总耗时 ${e.durationMs}ms`
        default:
          return `${t}  · ${e.type}`
      }
    })
    .join('\n')
}
