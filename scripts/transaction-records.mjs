import { stableHash } from "./data-utils.mjs";

// Releases must be passed oldest first, current release last. A cancellation
// replaces the old transaction before eligibility is evaluated.
export function latestTransactions(rows, { serial = "編號", cancellation = "解約情形", price = "單價元平方公尺" } = {}) {
  const latest = new Map();
  for (const row of rows) {
    const id = String(row[serial] || "").trim();
    latest.set(id || `anonymous:${stableHash(JSON.stringify(row), 64)}`, row);
  }
  return [...latest.values()].filter((row) => !String(row[cancellation] || "").trim() && Number.isFinite(Number(row[price])) && Number(row[price]) > 0);
}

// 官方「備註」標示的非常規交易（親友員工、特殊關係、急買急賣等）通常偏離市價，
// 不納入行情，避免把歷史最低價拉低。
const nonMarketRemark = /親友|員工|共有人|特殊關係|債權債務|急買急賣|瑕疵|凶宅|政府機關標|法拍|含增建/u;
export function isMarketSale(row, remark = "備註") {
  return !nonMarketRemark.test(String(row[remark] || ""));
}
