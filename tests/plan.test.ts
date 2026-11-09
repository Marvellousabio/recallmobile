/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addDays, buildPlan, dayDiff, LectureStat } from '../src/lib/plan';

const lec = (id: string, over: Partial<LectureStat> = {}): LectureStat => ({
  id,
  kind: 'lecture',
  date: '2026-11-01',
  title: id,
  cards: 10,
  unseen: 10,
  weak: 0,
  questions: 5,
  emphasised: 0,
  ...over,
});

const today = '2026-11-10';

test('date helpers cross month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(dayDiff('2026-11-10', '2026-11-24'), 14);
  assert.equal(dayDiff('2026-02-27', '2026-03-02'), 3);
});

test('every task falls between today and the day before the exam', () => {
  const exam = '2026-11-24';
  const plan = buildPlan([lec('a'), lec('b'), lec('c'), lec('p', { kind: 'past_paper' })], today, exam);
  for (const t of plan) {
    assert.ok(t.date >= today, `${t.kind} on ${t.date} is before today`);
    assert.ok(t.date < exam, `${t.kind} on ${t.date} is on/after exam day`);
  }
});

test('each lecture is learned once and quizzed at least 2 days later', () => {
  const plan = buildPlan([lec('a'), lec('b'), lec('c'), lec('d')], today, '2026-11-24');
  for (const id of ['a', 'b', 'c', 'd']) {
    const learn = plan.filter((t) => t.kind === 'learn' && t.ref_id === id);
    const quiz = plan.filter((t) => t.kind === 'quiz' && t.ref_id === id);
    assert.equal(learn.length, 1);
    assert.equal(quiz.length, 1);
    assert.ok(dayDiff(learn[0].date, quiz[0].date) >= 2, `quiz for ${id} too soon after learning`);
  }
});

test('the day before the exam is weak spots + mock, with no new learning', () => {
  const plan = buildPlan([lec('a'), lec('b')], today, '2026-11-17');
  const last = plan.filter((t) => t.date === '2026-11-16');
  assert.deepEqual(last.map((t) => t.kind).sort(), ['mock', 'weak']);
});

test('lecturer-emphasised and weak lectures are scheduled first', () => {
  const plan = buildPlan(
    [lec('plain'), lec('stressed', { emphasised: 4 }), lec('shaky', { weak: 5 })],
    today,
    '2026-11-30',
  );
  const order = plan.filter((t) => t.kind === 'learn').map((t) => t.ref_id);
  assert.deepEqual(order, ['stressed', 'shaky', 'plain']);
});

test('lectures with no AI output yet are left out; past papers land mid-plan', () => {
  const plan = buildPlan(
    [lec('a'), lec('empty', { cards: 0, questions: 0 }), lec('p1', { kind: 'past_paper', questions: 12 })],
    today,
    '2026-11-21',
  );
  assert.ok(!plan.some((t) => t.ref_id === 'empty'));
  const past = plan.filter((t) => t.kind === 'past');
  assert.equal(past.length, 1);
  assert.ok(past[0].date > today && past[0].date < '2026-11-20');
});

test('exam today → only a quick weak-spot pass and mock', () => {
  const plan = buildPlan([lec('a')], today, today);
  assert.deepEqual(plan.map((t) => t.kind), ['weak', 'mock']);
  assert.ok(plan.every((t) => t.date === today));
});

test('exam tomorrow → a single study day that still covers everything', () => {
  const plan = buildPlan([lec('a'), lec('b')], today, '2026-11-11');
  assert.ok(plan.every((t) => t.date === today));
  assert.equal(plan.filter((t) => t.kind === 'learn').length, 2);
  assert.ok(plan.some((t) => t.kind === 'mock'));
});

test('more lectures than days still fits, without empty-day crashes', () => {
  const many = Array.from({ length: 30 }, (_, i) => lec(`l${i}`));
  const plan = buildPlan(many, today, '2026-11-15');
  assert.equal(plan.filter((t) => t.kind === 'learn').length, 30);
  assert.ok(plan.every((t) => typeof t.date === 'string' && t.date.length === 10));
});
