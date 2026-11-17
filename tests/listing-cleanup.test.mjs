import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { displayBuilder, isMinorListing, missingDataLabels } from "../app/catalogue.ts";

// 2026-11 使用者回報：畫面太亂。以下規則確保卡片只顯示有用的資訊。
test("builder names drop people's names and agent notes from official records", () => {
  assert.equal(displayBuilder("昭揚開發股份有限公司:王愛國"), "昭揚開發股份有限公司");
  assert.equal(displayBuilder("築禾建設股份有限公司 起造人：黃劍輝"), "築禾建設股份有限公司");
  assert.equal(displayBuilder("家?開發地產有限公司 黃玉雪：如附表"), "家?開發地產有限公司");
  assert.equal(displayBuilder("九誠建設股份有限公司"), "九誠建設股份有限公司");
  assert.equal(displayBuilder("寶臨國際股份有限公司、元邑建築股份有限公司"), "寶臨國際股份有限公司、元邑建築股份有限公司"); // 合建不能少一家
});

test("tiny projects and parcel-numbered entries are treated as minor listings", () => {
  assert.equal(isMinorListing({ name: "康豐 ATM", households: 2 }), true);
  assert.equal(isMinorListing({ name: "楊富段1317、1317-1地號", households: 40 }), true);
  assert.equal(isMinorListing({ name: "九揚華樂", households: 10 }), false);
  assert.equal(isMinorListing({ name: "戶數未知", households: 0 }), false);
});

test("cards list missing data in one line instead of a placeholder per field", () => {
  assert.deepEqual(missingDataLabels({ price: null, amenity: { score: null }, quality: { status: "queued" } }), ["成交價", "生活機能", "品質查核"]);
  assert.deepEqual(missingDataLabels({ price: { median: 50 }, amenity: { score: 70 }, quality: { status: "reviewed" } }), []);
});

test("no displayed builder in the catalogue still contains a person or agent note", async () => {
  const { projects } = JSON.parse(await readFile(new URL("../data/processed/projects.json", import.meta.url), "utf8"));
  const leaked = projects.map((project) => displayBuilder(project.builder)).filter((name) => /[:：]|起造人|代理人|負責人/u.test(name));
  assert.deepEqual(leaked, []);
});
