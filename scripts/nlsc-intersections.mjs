const roadTokenPattern = /[\p{Script=Han}0-9]+?(?:大道(?:[一二三四五六七八九十0-9]+段)?|路(?:[一二三四五六七八九十0-9]+段)?|街)(?:[0-9]+(?:之[0-9]+)?巷)?(?:[0-9]+弄)?/gu;

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function sectionNumberText(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) return value;
  const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number < 10) return digits[number];
  if (number === 10) return "十";
  if (number < 20) return `十${digits[number - 10]}`;
  return "二十";
}

export function normalizeRoadName(value = "") {
  return value
    .normalize("NFKC")
    .replaceAll("台", "臺")
    .replace(/([路道])([0-9]{1,2})段/gu, (_match, road, section) => `${road}${sectionNumberText(section)}段`)
    .replace(/[\s，,、。．·・()（）]/gu, "")
    .replace(/(?:交岔路口|交叉路口|交叉口|交界處)$/gu, "")
    .replace(/路口$/u, "路")
    .replace(/街口$/u, "街")
    .replace(/(?:附近|旁|對面|工地)$/gu, "")
    .trim();
}

export function roadTokens(value) {
  return [...value.matchAll(roadTokenPattern)]
    .map((match) => normalizeRoadName(match[0]))
    .filter(Boolean);
}

export function extractIntersectionRoads(address = "") {
  const hasExplicitIntersection = /交叉|交岔|交界|(?:路|街|巷|道)口/u.test(address);
  const hasTwoRoadJoin = /(?:與|及|跟|和|、|，|,|\+|；|;|\.|。)/u.test(address) && !/\d+(?:之\d+)?號/u.test(address);
  if (!hasExplicitIntersection && !hasTwoRoadJoin) return null;
  const normalized = address
    .normalize("NFKC")
    .replace(/交岔路口|交叉路口|交叉口|交界處/gu, "")
    .replace(/(?:路口|街口)(?=附近|旁|對面|工地|$)/gu, (value) => value[0])
    .replace(/(?:附近|旁|對面工地|對面|工地)$/gu, "")
    .trim();
  let chunks = normalized.split(/(?:與|及|跟|、|，|,|\+|；|;|\.|。|間|近)/u).map((part) => part.trim()).filter(Boolean);
  if (chunks.length === 1 && normalized.includes("和")) {
    const andChunks = normalized.split("和").map((part) => part.trim()).filter(Boolean);
    if (andChunks.length === 2 && andChunks.every((part) => roadTokens(part).length === 1)) chunks = andChunks;
  }
  const candidates = chunks.length > 1 ? chunks.flatMap(roadTokens) : roadTokens(normalized);
  const unique = [...new Set(candidates)];
  return unique.length === 2 ? unique : null;
}

export function parseCountyItems(xml) {
  return Object.fromEntries([...xml.matchAll(/<countyItem>[\s\S]*?<countycode>([^<]+)<\/countycode>[\s\S]*?<countyname>([^<]+)<\/countyname>[\s\S]*?<\/countyItem>/gu)]
    .map((match) => [decodeXml(match[2]).trim(), decodeXml(match[1]).trim()]));
}

export function parseTownItems(xml) {
  return Object.fromEntries([...xml.matchAll(/<townItem>[\s\S]*?<towncode>([^<]+)<\/towncode>[\s\S]*?<townname>([^<]+)<\/townname>[\s\S]*?<\/townItem>/gu)]
    .map((match) => [decodeXml(match[2]).trim(), decodeXml(match[1]).trim()]));
}

export function parseCrossRoads(xml) {
  return [...xml.matchAll(/<crossRoad>\s*<name>([^<]+)<\/name>\s*<x>([^<]+)<\/x>\s*<y>([^<]+)<\/y>\s*<\/crossRoad>/gu)]
    .map((match) => ({
      name: decodeXml(match[1]).trim(),
      longitude: Number(match[2]),
      latitude: Number(match[3]),
    }))
    .filter((item) => Number.isFinite(item.longitude) && Number.isFinite(item.latitude));
}

export function findCrossRoad(crossRoads, targetRoad) {
  const target = normalizeRoadName(targetRoad);
  if (!target) return null;
  const exact = crossRoads.find((item) => normalizeRoadName(item.name) === target);
  if (exact) return exact;
  // 申報地址常省略「段」（例：中華路），官方路名是「中華路一段」；只有唯一一段時才採用，避免猜錯段。
  if (/[巷弄段]$/u.test(target)) return null;
  const sectioned = crossRoads.filter((item) => {
    const name = normalizeRoadName(item.name);
    return name.startsWith(target) && /^[一二三四五六七八九十]+段$/u.test(name.slice(target.length));
  });
  return sectioned.length === 1 ? sectioned[0] : null;
}

// 申報地址可能帶縣市區名或道路寬度（例：桃園市觀音區富貴一街、15米文昌五街），查官方路名前先去掉。
export function cleanDeclaredAddress(address = "", city = "", district = "") {
  let value = address.normalize("NFKC").trim();
  for (const prefix of [city, district, city.replace("臺", "台")]) {
    if (prefix && value.startsWith(prefix)) value = value.slice(prefix.length);
  }
  return value.replace(/\d+(?:\.\d+)?(?:米|公尺|M|m)(?=[\p{Script=Han}])/gu, "");
}

function distanceMeters(from, to) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export const ROAD_EXTENT_MAX_RADIUS_METERS = 500;

// 只有路名（或門牌）沒有路口時：用官方資料中這條路所有路口的中心當概略位置。
// 只在路口都落在 500 公尺內（短路、巷弄）時採用；長路無法判斷在哪一段，維持「未確認」。
export function roadExtent(crossRoads = []) {
  if (crossRoads.length < 2) return null;
  const center = {
    latitude: crossRoads.reduce((total, item) => total + item.latitude, 0) / crossRoads.length,
    longitude: crossRoads.reduce((total, item) => total + item.longitude, 0) / crossRoads.length,
  };
  const radiusMeters = Math.ceil(Math.max(...crossRoads.map((item) => distanceMeters(center, item))) / 50) * 50;
  return {
    latitude: Number(center.latitude.toFixed(6)),
    longitude: Number(center.longitude.toFixed(6)),
    radiusMeters: Math.max(50, radiusMeters),
    crossCount: crossRoads.length,
  };
}

// 從申報地址取出要查的道路：優先最細的巷弄，查不到再退回主要道路。
export function declaredRoadQueries(address = "") {
  const token = roadTokens(address.normalize("NFKC"))[0];
  if (!token) return [];
  const base = token.replace(/\d+(?:之\d+)?巷.*$/u, "");
  const lane = token.replace(/(\d+(?:之\d+)?巷).*$/u, "$1");
  return [...new Set([token, lane, base])].filter(Boolean);
}
