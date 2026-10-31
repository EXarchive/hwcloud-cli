// classroom.js —— 智慧课堂工作台核心逻辑（纯函数 + 可测状态机）
//
// 四块能力：
//   1. 签到：生成签到码、按码签到、统计出勤
//   2. 随机点名：公平权重（被点到次数少的权重高），避免总点同一人
//   3. 随堂测：单选题题库、提交判分、得分分布
//   4. 课堂看板：出勤率 / 平均分 / 参与度

/** 简单可复现随机数（便于测试） */
export function makeRng(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}

export function createSession({ id, title, students, seed = 7, now = Date.now() }) {
  if (!id || !title) throw new Error('session 需要 id 与 title')
  if (!Array.isArray(students) || students.length === 0) throw new Error('students 不能为空')
  return {
    id,
    title,
    createdAt: now,
    checkinCode: makeCheckinCode(seed),
    checkinOpen: true,
    students: students.map((name) => ({ name, checkedIn: false, checkinAt: null })),
    pickedCount: Object.fromEntries(students.map((n) => [n, 0])),
    quiz: null,
    rng: makeRng(seed),
  }
}

export function makeCheckinCode(seed) {
  const rng = makeRng(seed)
  return String(100000 + Math.floor(rng() * 900000))
}

/** 签到：重复签到幂等，返回本次是否生效 */
export function checkIn(session, studentName, code, now = Date.now()) {
  if (!session.checkinOpen) return { ok: false, reason: 'CLOSED' }
  if (String(code) !== session.checkinCode) return { ok: false, reason: 'BAD_CODE' }
  const student = session.students.find((s) => s.name === studentName)
  if (!student) return { ok: false, reason: 'UNKNOWN_STUDENT' }
  if (student.checkedIn) return { ok: true, reason: 'ALREADY', session }
  student.checkedIn = true
  student.checkinAt = now
  return { ok: true, reason: 'OK', session }
}

export function closeCheckin(session) {
  session.checkinOpen = false
  return session
}

export function attendance(session) {
  const total = session.students.length
  const present = session.students.filter((s) => s.checkedIn).length
  return { total, present, absent: total - present, rate: total ? Math.round((present / total) * 1000) / 10 : 0 }
}

/**
 * 随机点名：权重 = 1 / (1 + pickedCount)，长期看趋近均匀
 * exclude 可排除已答过的人
 */
export function pickStudent(session, exclude = []) {
  const pool = session.students.filter((s) => !exclude.includes(s.name))
  if (pool.length === 0) return null
  const weights = pool.map((s) => 1 / (1 + (session.pickedCount[s.name] ?? 0)))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = session.rng() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      session.pickedCount[pool[i].name] = (session.pickedCount[pool[i].name] ?? 0) + 1
      return pool[i].name
    }
  }
  const last = pool[pool.length - 1].name
  session.pickedCount[last] = (session.pickedCount[last] ?? 0) + 1
  return last
}

/** 发起随堂测 */
export function startQuiz(session, questions) {
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('题目不能为空')
  for (const q of questions) {
    if (!q.id || !q.stem || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`题目格式不合法: ${q.id ?? '(missing id)'}`)
    }
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) {
      throw new Error(`题目 ${q.id} 的 answer 越界`)
    }
  }
  session.quiz = { questions, submissions: {} }
  return session.quiz
}

/** 提交作答，返回得分与对错明细 */
export function submitQuiz(session, studentName, answers) {
  if (!session.quiz) throw new Error('尚未发起随堂测')
  const { questions } = session.quiz
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new Error('答案数量与题目数量不一致')
  }
  const detail = questions.map((q, i) => ({
    id: q.id,
    correct: answers[i] === q.answer,
    expected: q.answer,
    got: answers[i],
  }))
  const score = Math.round((detail.filter((d) => d.correct).length / questions.length) * 100)
  session.quiz.submissions[studentName] = { answers, score, at: Date.now() }
  return { score, detail }
}

/** 课堂看板 */
export function dashboard(session) {
  const att = attendance(session)
  const subs = Object.entries(session.quiz?.submissions ?? {})
  const scores = subs.map(([, v]) => v.score)
  const avg = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0
  const distribution = {}
  for (const s of scores) {
    const bucket = s === 100 ? '100' : `${Math.floor(s / 20) * 20}-${Math.floor(s / 20) * 20 + 19}`
    distribution[bucket] = (distribution[bucket] ?? 0) + 1
  }
  const pickedTotal = Object.values(session.pickedCount).reduce((a, b) => a + b, 0)
  const pickedUnique = Object.values(session.pickedCount).filter((v) => v > 0).length
  return {
    attendance: att,
    quiz: {
      submitted: subs.length,
      avgScore: avg,
      distribution,
      participation: att.present ? Math.round((subs.length / att.present) * 1000) / 10 : 0,
    },
    picking: { total: pickedTotal, unique: pickedUnique, fairness: att.present ? Math.round((pickedUnique / att.present) * 1000) / 10 : 0 },
  }
}
