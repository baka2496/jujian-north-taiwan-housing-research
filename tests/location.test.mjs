import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { amenityBounds, insideAmenityBounds } from "../scripts/amenity-rules.mjs";
import {
  cleanDeclaredAddress,
  declaredRoadQueries,
  extractIntersectionRoads,
  findCrossRoad,
  ROAD_EXTENT_MAX_RADIUS_METERS,
  roadExtent,
} from "../scripts/nlsc-intersections.mjs";

const amenities = JSON.parse(await readFile(new URL("../data/processed/amenities.json", import.meta.url), "utf8"));
const regions = JSON.parse(await readFile(new URL("../data/regions.json", import.meta.url), "utf8")).regions;

// 2026-11 使用者要求補齊建案位置與生活機能；以下確保補上的位置有根據、誤差有標明。
test("declared addresses are cleaned before matching official road names", () => {
  assert.equal(cleanDeclaredAddress("桃園市觀音區富貴一街與富貴一街113巷交界", "桃園市", "觀音區"), "富貴一街與富貴一街113巷交界");
  assert.deepEqual(extractIntersectionRoads(cleanDeclaredAddress("15米文昌五街與15米復興南路交叉口")), ["文昌五街", "復興南路"]);
});

test("a road named without its section only matches when exactly one section crosses", () => {
  const crosses = [{ name: "中華路一段", latitude: 25, longitude: 121 }, { name: "中平路", latitude: 25.01, longitude: 121 }];
  assert.equal(findCrossRoad(crosses, "中華路")?.name, "中華路一段");
  assert.equal(findCrossRoad([...crosses, { name: "中華路二段", latitude: 25.02, longitude: 121 }], "中華路"), null);
  assert.equal(findCrossRoad(crosses, "中華路10巷"), null);
});

test("road-only addresses query the lane first, then the main road", () => {
  assert.deepEqual(declaredRoadQueries("八德路500巷"), ["八德路500巷", "八德路"]);
  assert.deepEqual(declaredRoadQueries("松柏路78號旁"), ["松柏路"]);
  assert.deepEqual(declaredRoadQueries("同福段605地號"), []);
});

test("road extent uses the centre of official intersections and reports a rounded error radius", () => {
  const extent = roadExtent([
    { name: "A", latitude: 25.0000, longitude: 121.0000 },
    { name: "B", latitude: 25.0020, longitude: 121.0000 },
  ]);
  assert.equal(extent.latitude, 25.001);
  assert.equal(extent.radiusMeters, 150); // 111 公尺進位到 50 公尺
  assert.equal(roadExtent([{ name: "A", latitude: 25, longitude: 121 }]), null);
});

test("every road-estimated location states its error radius and stays within the limit", () => {
  const roadLocated = Object.values(amenities.projects).filter((project) => project.location.method === "nlsc-road-extent");
  assert.ok(roadLocated.length > 500, `道路概略位置只有 ${roadLocated.length} 案`);
  for (const project of roadLocated) {
    const radius = project.location.officialReference.radiusMeters;
    assert.ok(radius <= ROAD_EXTENT_MAX_RADIUS_METERS);
    assert.equal(project.location.label, `道路概略位置（約 ${radius} 公尺內）`);
    assert.equal(project.location.confidence, "low");
    assert.notEqual(project.scoreReliability, "verified");
  }
});

test("projects without a confirmed location never show an amenity score", () => {
  for (const project of Object.values(amenities.projects)) {
    if (project.location.confidence === "estimated") assert.equal(project.score, null);
    else assert.ok(insideAmenityBounds(project.location));
  }
});

test("amenity scoring is only enabled where facility data was fetched for the whole region", () => {
  assert.ok(regions.every((region) => region.amenityEnabled));
  assert.equal(amenities.methodology.poiBounds, `${amenityBounds.south},${amenityBounds.west},${amenityBounds.north},${amenityBounds.east}`);
  for (const [category, count] of Object.entries(amenities.poiCountsByCategory)) assert.ok(count > 0, `${category} 沒有設施資料`);
});

// 2026-11 使用者要求查證好市多：曾把「好市多觀音物流中心」當成最近分店，且只用直線距離挑分店。
test("costco stores exclude warehouses and are chosen by measured peak driving time", async () => {
  const { classifyPoi, isCostcoStore } = await import("../scripts/enrich-amenities.mjs");
  assert.equal(classifyPoi({ name: "好市多觀音物流中心", building: "warehouse" }), null);
  assert.equal(classifyPoi({ name: "好市多", shop: "wholesale" }), "costco");
  assert.equal(isCostcoStore("Costco Logistics Depot", { building: "yes" }), false);

  const stores = amenities.pois.filter((poi) => poi.category === "costco");
  assert.equal(stores.length, 8, "雙北桃竹範圍內應有 8 家好市多賣場");
  assert.ok(stores.every((poi) => !/物流|倉儲|倉庫/u.test(poi.name)));

  const scored = Object.values(amenities.projects).filter((project) => project.score !== null && project.nearest.costco);
  assert.ok(scored.length > 1000);
  for (const project of scored) {
    assert.equal(project.nearest.costco.chosenBy, "peak-driving");
    assert.ok(project.nearest.costco.alternativesChecked >= 2);
  }
  // 人工實測（Valhalla 平日 8 時）：京懋明日和到南崁店 20 分、中和店 28 分、中壢店 31 分。
  assert.equal(amenities.projects["new-taipei-87b8ebf622"].nearest.costco.id, "way-183547237");
});
