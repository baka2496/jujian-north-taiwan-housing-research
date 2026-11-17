import { isMarketSale, latestTransactions } from "./transaction-records.mjs";
import { readFile, readdir, writeFile, mkdir, access } from "node:fs/promises";
import { regions } from "./regions.mjs";
import { fetchBytes, parseCsv, normalizeName, rocToIso, todayTaipei } from "./data-utils.mjs";

// 用內政部「預售屋」完整歷史季度（110S1 起）＋本期資料，替每個建案配對成交。
// 舊版只用本期快照（約 10 天），導致九成建案沒有價格。
const root = new URL("../", import.meta.url);
const output = new URL("data/processed/projects.json", root);
const dataset = JSON.parse(await readFile(output, "utf8"));
const snapshot = process.argv.includes("--snapshot");
const download = process.argv.includes("--download") || process.argv.includes("--download-history");
const officialBase = "https://plvr.land.moi.gov.tw";
const historyDirectory = new URL("data/source/presale-history/", root);
const currentDirectory = new URL(snapshot ? "data/source/lvr_landcsv/" : "data/source/current-transactions/", root);
export const FIRST_SEASON = "110S1";
const SOURCE_LABEL = "內政部預售屋實價登錄（歷史季度＋本期）";
await mkdir(historyDirectory, { recursive: true });
await mkdir(currentDirectory, { recursive: true });

const exists = (url) => access(url).then(() => true, () => false);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const missing = [];
const letters = [...new Set(regions.map((region) => region.file[0]))];

async function downloadHistory() {
  const html = (await fetchBytes(`${officialBase}/DownloadSeason_ajax_list`, { method: "POST" })).toString("utf8");
  const seasons = [...new Set([...html.matchAll(/<option value="(\d{3}S[1-4])">/gu)].map((match) => match[1]))].filter((season) => season >= FIRST_SEASON).sort();
  if (!seasons.length) throw new Error("官方歷史季度清單沒有回傳可用資料");
  const recent = new Set(seasons.slice(-2)); // 最近兩季官方仍可能補登或解約，每次重抓
  let fetched = 0;
  for (const season of seasons) {
    for (const letter of letters) {
      const target = new URL(`${season}_${letter.toUpperCase()}_lvr_land_B.csv`, historyDirectory);
      if (!recent.has(season) && await exists(target)) continue;
      let bytes = null;
      for (let attempt = 1; attempt <= 3 && !bytes; attempt += 1) {
        await pause(attempt === 1 ? 300 : 3000 * attempt); // 對官方伺服器保持間隔
        const body = await fetchBytes(`${officialBase}/DownloadSeason?${new URLSearchParams({ season, fileName: `${letter.toUpperCase()}_lvr_land_B.csv` })}`);
        const header = body.toString("utf8").split("\n", 1)[0];
        if (["單價元平方公尺", "建案名稱", "鄉鎮市區"].every((field) => header.includes(field))) bytes = body;
        else if (!body.toString("utf8").includes("系統訊息")) throw new Error(`${season} ${letter} 季度檔欄位無效`);
      }
      // 官方對部分季度只回「系統訊息」空白頁；記錄缺口，不中斷更新、不假裝有資料
      if (!bytes) { missing.push(`${season}_${letter.toUpperCase()}`); continue; }
      await writeFile(target, bytes);
      fetched += 1;
    }
  }
  if (!snapshot) for (const letter of letters) {
    await writeFile(new URL(`${letter}_lvr_land_b.csv`, currentDirectory), await fetchBytes(`${officialBase}/Download?fileName=${letter}_lvr_land_b.csv`));
  }
  console.log(`已下載 ${fetched} 個季度檔（${seasons[0]}–${seasons.at(-1)}）與本期資料${missing.length ? `；官方未提供：${missing.join("、")}` : ""}`);
  return seasons;
}

if (download) await downloadHistory();

const historyFiles = (await readdir(historyDirectory)).filter((name) => /^\d{3}S[1-4]_[A-Z]_lvr_land_B\.csv$/u.test(name)).sort();
const seasonsSeen = [...new Set(historyFiles.map((name) => name.slice(0, 5)))].sort();

const officialIdentities = new Map();
const sources = new Map();
for (const region of regions) {
  if (sources.has(region.city)) continue;
  const buildDirectory = snapshot ? "data/source/lvr_buildcasecsv/" : "data/source/current-buildcases/";
  const builds = parseCsv(await readFile(new URL(buildDirectory + region.file, root), "utf8"));
  for (const row of builds) {
    const key = `${region.city}:${row.鄉鎮市區}:${normalizeName(row.建案名稱)}`;
    if (!officialIdentities.has(key)) officialIdentities.set(key, new Set());
    officialIdentities.get(key).add(row.編號 || row.建造執照 || row.坐落基地);
  }
  const letter = region.file[0];
  const files = historyFiles.filter((name) => name[6] === letter.toUpperCase()).map((name) => new URL(name, historyDirectory));
  const current = new URL(`${letter}_lvr_land_b.csv`, currentDirectory);
  if (await exists(current)) files.push(current); // 本期最後讀，讓最新的解約紀錄蓋過舊紀錄
  if (!files.length) throw new Error(`${region.city} 沒有任何預售屋成交檔，請先用 --download 下載`);
  const rows = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (!["建案名稱", "鄉鎮市區", "單價元平方公尺"].every((field) => text.split("\n")[0].includes(field))) throw new Error(`${file.pathname} 成交欄位無效`);
    const parsed = parseCsv(text, { singleLineFields: true });
    // 寬鬆模式下仍檢查截斷：最後一列欄位數必須和標題一致
    const width = text.split("\n", 1)[0].split(",").length;
    const last = text.trimEnd().split("\n").at(-1).split(",").length;
    if (last < width - 1) throw new Error(`${file.pathname} 最後一列欄位不足，可能為截斷下載`);
    rows.push(...parsed);
  }
  const byKey = new Map();
  let excluded = 0;
  for (const row of latestTransactions(rows)) {
    if (!isMarketSale(row)) { excluded += 1; continue; }
    const key = `${row.鄉鎮市區}|${normalizeName(row.建案名稱)}`;
    if (!row.建案名稱) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  sources.set(region.city, { byKey, files: files.length, excluded, url: `${officialBase}/DownloadOpenData` });
}

const round = (value) => Math.round(value * 10) / 10;
let matched = 0;
for (const project of dataset.projects) {
  // 林口用新北市府完整開放資料、A7 另有地址佐證，兩者由 refresh-project-prices 處理
  if (["林口", "A7"].includes(project.region)) continue;
  const source = sources.get(project.city);
  const sameIdentity = (item) => item.city === project.city && item.district === project.district && normalizeName(item.name) === normalizeName(project.name);
  const ambiguous = dataset.projects.filter(sameIdentity).length > 1 || (officialIdentities.get(`${project.city}:${project.district}:${normalizeName(project.name)}`)?.size || 0) > 1;
  const rows = ambiguous ? [] : source.byKey.get(`${project.district}|${normalizeName(project.name)}`) || [];
  const prices = rows.map((row) => Number(row.單價元平方公尺) * 3.305785 / 10000).sort((a, b) => a - b);
  const dates = rows.map((row) => rocToIso(row.交易年月日)).filter(Boolean).sort();
  project.price = prices.length ? {
    median: round((prices[Math.floor((prices.length - 1) / 2)] + prices[Math.floor(prices.length / 2)]) / 2), low: round(prices[0]), high: round(prices.at(-1)), count: prices.length,
    earliestDate: dates[0] || null, latestDate: dates.at(-1) || null, source: SOURCE_LABEL,
  } : null;
  if (prices.length) matched += 1;
  project.priceEvidence = {
    status: prices.length ? "matched" : ambiguous ? "source-no-match" : "official-no-match",
    statusLabel: prices.length ? "官方成交已配對" : ambiguous ? "同名建案待人工歸戶" : "官方尚無可配對成交",
    matchMethod: `同縣市＋行政區＋正規化建案名稱唯一配對；${seasonsSeen[0] || FIRST_SEASON} 起歷史季度＋本期，排除解約與親友員工等特殊交易`,
    addressCorroborated: null, addressTokens: [], lastCheckedAt: todayTaipei(), sourceUrl: source.url,
  };
}
dataset.priceCoverage.totalProjects = dataset.projects.length;
dataset.priceCoverage.pricedProjects = dataset.projects.filter((project) => project.price).length;
dataset.priceCoverage.historyFrom = seasonsSeen[0] || FIRST_SEASON;
dataset.priceCoverage.historyTo = seasonsSeen.at(-1) || null;
dataset.priceCoverage.checkedAt = todayTaipei();
if (download) dataset.priceCoverage.unavailableSeasonFiles = missing;
await writeFile(output, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`分區價格完成：本次配對 ${matched} 案；全部 ${dataset.priceCoverage.pricedProjects}/${dataset.projects.length} 案有成交樣本（${seasonsSeen[0]}–${seasonsSeen.at(-1)}）`);
for (const [city, source] of sources) console.log(`  ${city}：讀取 ${source.files} 個檔，排除特殊交易 ${source.excluded} 筆`);
