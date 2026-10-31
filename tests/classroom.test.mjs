#!/usr/bin/env node
// tests/classroom.test.mjs —— 智慧课堂工作台逻辑单测
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attendance,
  checkIn,
  closeCheckin,
  createSession,
  dashboard,
  pickStudent,
  startQuiz,
  submitQuiz,
} from '../src/classroom.js'

const STUDENTS = ['张三', '李四', '王五', '赵六', '钱七']

function newSession(seed = 7) {
  return createSession({ id: 's1', title: '数据结构第 8 讲', students: STUDENTS, seed })
}

test('createSession 生成 6 位签到码与初始状态', () => {
  const s = newSession()
  assert.match(s.checkinCode, /^\d{6}$/)
  assert.equal(s.students.length, 5)
  assert.equal(s.checkinOpen, true)
  assert.ok(s.students.every((x) => x.checkedIn === false))
})

test('签到：正确码生效、错码与未知名被拒、重复签到幂等', () => {
  const s = newSession()
  assert.equal(checkIn(s, '张三', '000000').reason, 'BAD_CODE')
  assert.equal(checkIn(s, '不存在', s.checkinCode).reason, 'UNKNOWN_STUDENT')

  const first = checkIn(s, '张三', s.checkinCode)
  assert.equal(first.ok, true)
  assert.equal(first.reason, 'OK')

  const again = checkIn(s, '张三', s.checkinCode)
  assert.equal(again.reason, 'ALREADY')
  assert.equal(attendance(s).present, 1, '重复签到不应重复计数')
})

test('关闭签到后拒绝新签到', () => {
  const s = newSession()
  checkIn(s, '张三', s.checkinCode)
  closeCheckin(s)
  assert.equal(checkIn(s, '李四', s.checkinCode).reason, 'CLOSED')
})

test('attendance 计算出勤率', () => {
  const s = newSession()
  checkIn(s, '张三', s.checkinCode)
  checkIn(s, '李四', s.checkinCode)
  const a = attendance(s)
  assert.deepEqual({ total: a.total, present: a.present, absent: a.absent }, { total: 5, present: 2, absent: 3 })
  assert.equal(a.rate, 40)
})

test('随机点名：不排除时总能点到人，且记录次数', () => {
  const s = newSession()
  const name = pickStudent(s)
  assert.ok(STUDENTS.includes(name))
  assert.equal(s.pickedCount[name], 1)
})

test('随机点名：exclude 生效，全部排除时返回 null', () => {
  const s = newSession()
  const first = pickStudent(s)
  const second = pickStudent(s, [first])
  assert.notEqual(second, first)
  assert.equal(pickStudent(s, STUDENTS), null)
})

test('随机点名趋于公平：100 次后每人至少被点 5 次', () => {
  const s = newSession(42)
  for (let i = 0; i < 100; i++) pickStudent(s)
  const counts = Object.values(s.pickedCount)
  assert.equal(counts.reduce((a, b) => a + b, 0), 100)
  assert.ok(Math.min(...counts) >= 5, `最少被点 ${Math.min(...counts)} 次，公平性不足`)
})

test('startQuiz 校验题目格式', () => {
  const s = newSession()
  assert.throws(() => startQuiz(s, []), /题目不能为空/)
  assert.throws(
    () => startQuiz(s, [{ id: 'q1', stem: 'x', options: ['a', 'b'], answer: 5 }]),
    /answer 越界/,
  )
})

test('submitQuiz 判分正确并计算百分比', () => {
  const s = newSession()
  startQuiz(s, [
    { id: 'q1', stem: '1+1', options: ['1', '2'], answer: 1 },
    { id: 'q2', stem: '2+2', options: ['3', '4'], answer: 1 },
    { id: 'q3', stem: '3+3', options: ['6', '7'], answer: 0 },
    { id: 'q4', stem: '4+4', options: ['8', '9'], answer: 0 },
  ])
  const perfect = submitQuiz(s, '张三', [1, 1, 0, 0])
  assert.equal(perfect.score, 100)

  const half = submitQuiz(s, '李四', [1, 1, 1, 1])
  assert.equal(half.score, 50)
  assert.equal(half.detail.filter((d) => d.correct).length, 2)
})

test('submitQuiz 拒绝答案数量不一致', () => {
  const s = newSession()
  startQuiz(s, [{ id: 'q1', stem: 'x', options: ['a', 'b'], answer: 0 }])
  assert.throws(() => submitQuiz(s, '张三', [0, 1]), /数量与题目数量不一致/)
})

test('dashboard 汇总出勤、得分与参与度', () => {
  const s = newSession()
  for (const n of STUDENTS) checkIn(s, n, s.checkinCode)
  startQuiz(s, [
    { id: 'q1', stem: 'x', options: ['a', 'b'], answer: 0 },
    { id: 'q2', stem: 'y', options: ['a', 'b'], answer: 1 },
  ])
  submitQuiz(s, '张三', [0, 1]) // 100
  submitQuiz(s, '李四', [0, 0]) // 50
  pickStudent(s)

  const d = dashboard(s)
  assert.equal(d.attendance.present, 5)
  assert.equal(d.attendance.rate, 100)
  assert.equal(d.quiz.submitted, 2)
  assert.equal(d.quiz.avgScore, 75)
  assert.equal(d.quiz.participation, 40)
  assert.equal(d.picking.total, 1)
})

test('无随堂测时 dashboard 不报错', () => {
  const s = newSession()
  const d = dashboard(s)
  assert.equal(d.quiz.submitted, 0)
  assert.equal(d.quiz.avgScore, 0)
  assert.deepEqual(d.quiz.distribution, {})
})
