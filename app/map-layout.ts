export type ScreenPoint = { id: string; x: number; y: number };
export type ScreenGroup = { ids: string[]; x: number; y: number };

/**
 * 估計地圖標籤的像素寬度（中文 14px 粗體約 15px／字，數字約 8.5px，「案」等小字約 13px）。
 * 2026-11 使用者：「都要超出標籤了，太擠了」——標籤寬度要跟著文字，碰撞判斷也用真實寬度。
 */
export function estimateLabelWidth(name: string, count?: number, padding = 28) {
  const textWidth = (text: string, cjk: number, other: number) => [...text].reduce((sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? cjk : other), 0);
  const countText = count === undefined ? "" : `${count.toLocaleString("zh-TW")} 案`;
  const gap = countText && name ? 6 : 0;
  return Math.ceil(textWidth(name, 15, 8.5) + gap + textWidth(countText, 13, 7.5) + padding);
}

// Merge overlapping label rectangles, including new collisions caused by a
// merged centroid. Order is stable so selecting a project does not reshuffle it.
// `width` can be a number, or a function giving each group's real label width;
// `gap` keeps a little air between neighbouring labels.
export function groupMapLabels(points: ScreenPoint[], width: number | ((ids: string[]) => number) = 128, height = 48, gap = 0): ScreenGroup[] {
  const widthOf = typeof width === "number" ? () => width : width;
  const groups = [...points].sort((a, b) => a.id.localeCompare(b.id)).map((point) => ({ ids: [point.id], x: point.x, y: point.y }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const a = groups[i], b = groups[j];
        const minX = (widthOf(a.ids) + widthOf(b.ids)) / 2 + gap;
        if (Math.abs(a.x - b.x) >= minX || Math.abs(a.y - b.y) >= height + gap) continue;
        const size = a.ids.length + b.ids.length;
        groups[i] = { ids: [...a.ids, ...b.ids], x: (a.x * a.ids.length + b.x * b.ids.length) / size, y: (a.y * a.ids.length + b.y * b.ids.length) / size };
        groups.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return groups;
}
