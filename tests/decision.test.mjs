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
