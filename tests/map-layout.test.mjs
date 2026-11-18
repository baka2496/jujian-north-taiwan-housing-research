import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMapLabels } from '../app/map-layout.ts';

test('co-located buildings remain individually selectable through a complete group', () => {
  const points = Array.from({ length: 40 }, (_, i) => ({ id: `project-${i}`, x: 250, y: 400 }));
  const groups = groupMapLabels(points);
  assert.equal(groups.length, 1);
  assert.deepEqual(new Set(groups[0].ids), new Set(points.map(p => p.id)));
  assert.equal(groups[0].x, 250);
  assert.equal(groups[0].y, 400);
});

test('labels have no overlap after merging, with no lost or duplicate projects', () => {
  const points = Array.from({ length: 300 }, (_, i) => ({ id: `project-${i}`, x: (i * 73) % 1080, y: (i * 127) % 720 }));
  const groups = groupMapLabels(points);
  const ids = groups.flatMap(g => g.ids);
  assert.equal(ids.length, points.length);
  assert.deepEqual(new Set(ids), new Set(points.map(p => p.id)));
  groups.forEach((a, i) => groups.slice(i + 1).forEach(b => assert.ok(Math.abs(a.x - b.x) >= 128 || Math.abs(a.y - b.y) >= 48)));
  assert.deepEqual(groupMapLabels([...points].reverse()), groups);
});

test('well-separated buildings keep their exact coordinate and singleton label', () => {
  const points = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 240, y: 100 }, { id: 'c', x: 100, y: 160 }];
  assert.deepEqual(groupMapLabels(points), points.map(p => ({ ids: [p.id], x: p.x, y: p.y })));
  assert.deepEqual(groupMapLabels([]), []);
});

// 2026-11 使用者：「都要超出標籤了，太擠了」
test('label width follows the text, so long labels are not squeezed into a fixed box', async () => {
  const { estimateLabelWidth } = await import('../app/map-layout.ts');
  assert.ok(estimateLabelWidth('中壢區', 172) < estimateLabelWidth('新竹市東區', 1074));
  // 「中壢區 172 案」實際約 110px，估計不得低於實際寬度
  assert.ok(estimateLabelWidth('中壢區', 172) >= 105);
  assert.ok(estimateLabelWidth('＋', 198) < estimateLabelWidth('中壢區', 198));
});

test('labels whose real widths overlap are merged; labels with room between them are not', () => {
  const widths = { a: 150, b: 150, c: 60, d: 60 };
  const widthOf = ids => Math.max(...ids.map(id => widths[id]));
  // a、b 中心相距 140px，但各寬 150px → 會重疊，要合併
  assert.equal(groupMapLabels([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 140, y: 0 }], widthOf, 34, 10).length, 1);
  // c、d 各寬 60px，相距 80px（> 60 + 10 間距）→ 不合併
  assert.equal(groupMapLabels([{ id: 'c', x: 0, y: 0 }, { id: 'd', x: 80, y: 0 }], widthOf, 34, 10).length, 2);
});

// 2026-11 使用者：「滑動地圖，縮放地圖很卡」——1,500 個點的標籤合併以前要 4.6 秒，現在必須在 150ms 內
test('label merging stays fast with many points and still leaves no overlaps', async () => {
  const { estimateLabelWidth } = await import('../app/map-layout.ts');
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const points = Array.from({ length: 1500 }, (_, i) => ({ id: `p${String(i).padStart(5, '0')}`, x: rnd() * 1100, y: rnd() * 760 }));
  const widthOf = ids => ids.length === 1 ? estimateLabelWidth('48.5 萬／坪', undefined, 26) : Math.max(64, estimateLabelWidth('＋', ids.length, 34));
  const started = performance.now();
  const groups = groupMapLabels(points, widthOf, 36, 8);
  assert.ok(performance.now() - started < 150, `took ${Math.round(performance.now() - started)}ms`);
  assert.equal(groups.reduce((sum, g) => sum + g.ids.length, 0), 1500);
  for (let i = 0; i < groups.length; i += 1) for (let j = i + 1; j < groups.length; j += 1) {
    const a = groups[i], b = groups[j];
    const overlap = Math.abs(a.x - b.x) < (widthOf(a.ids) + widthOf(b.ids)) / 2 + 8 && Math.abs(a.y - b.y) < 36 + 8;
    assert.ok(!overlap, `${i} and ${j} overlap`);
  }
});
