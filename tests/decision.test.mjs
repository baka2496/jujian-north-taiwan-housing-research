import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidate } from '../app/decision.ts';

const needs = { budget: 2000, indoor: 20, maxAge: 5, elevator: true, destinationA: '台北車站', destinationB: '', commute: 40 };
test('historical prices and first registration never prove a home meets purchase requirements', () => {
  const result = assessCandidate(needs, {}, '2026-11-11');
  assert.equal(result.status, 'unknown');
  assert.equal(result.checks.filter(c => c.state === 'pass').length, 0);
  assert.ok(result.checks.some(c => c.key === 'availability' && c.state === 'unknown'));
});
test('a recorded over-budget asking price excludes a candidate and an old sale claim expires', () => {
  const result = assessCandidate(needs, { asking: '2100', source: '接待中心現場', date: '2026-11-10', availability: 'yes' }, '2026-11-11');
  assert.equal(result.status, 'fail');
  assert.equal(result.checks.find(c => c.key === 'budget').state, 'fail');
  assert.equal(result.checks.find(c => c.key === 'availability').state, 'pass');
  assert.equal(assessCandidate(needs, { availability: 'yes', source: '接待中心', date: '2026-10-01' }, '2026-11-11').checks[0].state, 'unknown');
});
test('complete sourced observations can meet requirements but changed commute destinations need rechecking', () => {
  const visit = { asking: '1900', indoor: '22', completed: '2022-01-01', elevator: 'yes', availability: 'yes', minutesA: '35', destinationA: '台北車站', source: '2026 現場看屋', date: '2026-11-10' };
  assert.equal(assessCandidate(needs, visit, '2026-11-11').status, 'pass');
  assert.equal(assessCandidate({ ...needs, destinationA: '新竹車站' }, visit, '2026-11-11').checks.find(c => c.key === 'commuteA').state, 'unknown');
  assert.equal(assessCandidate(needs, { ...visit, completed: '2021-11-10' }, '2026-11-11').checks.find(c => c.key === 'age').state, 'fail');
  assert.equal(assessCandidate(needs, { ...visit, date: '2026-12-01' }, '2026-11-11').status, 'unknown');
});
test('empty or invalid requirements do not create a false pass or exclusion', () => {
  const result = assessCandidate({ ...needs, budget: 0, indoor: -1, commute: 0 }, { asking: '1800', indoor: '15', minutesA: '30', destinationA: '台北車站', source: '驗收', date: '2026-11-11' }, '2026-11-11');
  for (const key of ['budget', 'indoor', 'commuteA']) assert.equal(result.checks.find(c => c.key === key).state, 'unknown');
});

// 使用者回報：底線（預算、坪數、屋齡）完全不會影響候選，704 個看起來都一樣。以下確保預判真的生效。
import { prescreenCandidate, compareByPrescreen } from '../app/decision.ts';
const facts = (median, low, count = 20, firstRegistrationDate = null) => ({ price: { median, low, count }, firstRegistrationDate });
test('budget and indoor size pre-screen candidates using historical prices without passing them', () => {
  // 20 坪室內 ÷ (1 − 33%) ≈ 29.85 坪權狀
  assert.equal(prescreenCandidate(needs, facts(60, 50), '2026-11-17').level, 'within'); // 中位 ≈ 1,791 萬
  assert.equal(prescreenCandidate(needs, facts(70.1, 60), '2026-11-17').level, 'tight'); // 最低 ≈ 1,791、中位 ≈ 2,092 萬
  const over = prescreenCandidate(needs, facts(90, 80), '2026-11-17'); // 最低 ≈ 2,388 萬
  assert.equal(over.level, 'over');
  assert.match(over.budget.detail, /2,390 萬起/);
  assert.match(over.budget.detail, /未含車位/);
  // 預算放寬後同一個建案就不再超出
  assert.notEqual(prescreenCandidate({ ...needs, budget: 3000 }, facts(90, 80), '2026-11-17').level, 'over');
  // 要的坪數變大，原本在預算內的會變成超出
  assert.equal(prescreenCandidate({ ...needs, indoor: 40 }, facts(60, 50), '2026-11-17').level, 'over');
  // 估算絕不會讓任何條件變成「符合」
  const assessed = assessCandidate(needs, {}, '2026-11-17', facts(60, 50));
  assert.equal(assessed.checks.filter(c => c.state === 'pass').length, 0);
  assert.match(assessed.checks.find(c => c.key === 'budget').detail, /估算約 1,790 萬/);
});
test('too few sales or missing inputs leave the estimate unknown instead of guessing', () => {
  assert.equal(prescreenCandidate(needs, facts(40, 30, 2), '2026-11-17').level, 'unknown');
  assert.equal(prescreenCandidate(needs, { price: null }, '2026-11-17').level, 'unknown');
  assert.equal(prescreenCandidate({ ...needs, budget: 0 }, facts(40, 30), '2026-11-17').level, 'unknown');
});
test('first registration older than the age limit marks a candidate as over, newer stays unknown', () => {
  assert.equal(prescreenCandidate(needs, facts(40, 30, 20, '2021-10-29'), '2026-11-17').level, 'over');
  const recent = prescreenCandidate(needs, facts(40, 30, 20, '2023-05-01'), '2026-11-17');
  assert.equal(recent.age.level, 'unknown');
  assert.equal(recent.level, 'within');
  assert.equal(prescreenCandidate({ ...needs, maxAge: 0 }, facts(40, 30, 20, '2015-01-01'), '2026-11-17').age, null);
});
test('candidates sort by fit first, then by most recent sale', () => {
  const make = (name, median, low, latestDate) => { const project = { name, price: { median, low, count: 10, latestDate } }; return { project, prescreen: prescreenCandidate(needs, project, '2026-11-17') }; };
  const order = [make('超出', 90, 80, '2026-10-01'), make('無資料', 0, 0, null), make('接近', 70.1, 60, '2026-01-01'), make('預算內舊', 50, 45, '2024-01-01'), make('預算內新', 55, 50, '2026-09-01')].sort(compareByPrescreen).map(x => x.project.name);
  assert.deepEqual(order, ['預算內新', '預算內舊', '接近', '無資料', '超出']);
});
