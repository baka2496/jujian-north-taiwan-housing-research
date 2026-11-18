// 生活機能「附近有幾家」的計算範圍；enrich-amenities 用完整設施清單計數，enrich-route-times 用來算數量分數。
export const densityRules = {
  convenience: { radiusMeters: 800, targetCount: 6, densityWeight: 0.25 },
  pxmart: { radiusMeters: 1500, targetCount: 3, densityWeight: 0.25 },
  costco: { radiusMeters: 15000, targetCount: 1, densityWeight: 0 },
  station: { radiusMeters: 1500, targetCount: 2, densityWeight: 0.25 },
  school: { radiusMeters: 1500, targetCount: 4, densityWeight: 0.25 },
  medical: { radiusMeters: 1200, targetCount: 4, densityWeight: 0.25 },
  market: { radiusMeters: 1500, targetCount: 3, densityWeight: 0.25 },
  park: { radiusMeters: 1200, targetCount: 4, densityWeight: 0.25 },
  pharmacy: { radiusMeters: 1000, targetCount: 5, densityWeight: 0.25 },
  parking: { radiusMeters: 1000, targetCount: 5, densityWeight: 0.25 },
};

// 設施查詢範圍：涵蓋新竹縣到臺北、新北全區。建案若落在範圍外，enrich-amenities 會直接報錯。
export const amenityBounds = { south: 24.4, west: 120.7, north: 25.35, east: 122.05 };

export function insideAmenityBounds({ latitude, longitude }) {
  return latitude >= amenityBounds.south && latitude <= amenityBounds.north
    && longitude >= amenityBounds.west && longitude <= amenityBounds.east;
}
