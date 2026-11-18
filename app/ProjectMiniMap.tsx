import amenityDataset from '@/data/processed/amenities.json';

type Location = { latitude: number; longitude: number; confidence: string; label?: string; officialReference?: { radiusMeters?: number } };
const locations = (amenityDataset as unknown as { projects: Record<string, { location?: Location }> }).projects;

const ZOOM = 15;
const TILE = 256;

/** 經緯度換成 zoom 15 的全域像素座標（Web Mercator）。 */
export function worldPixel(latitude: number, longitude: number, zoom = ZOOM) {
  const scale = TILE * 2 ** zoom;
  const x = ((longitude + 180) / 360) * scale;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** 2×2 張圖磚，讓建案點一定落在中央區域；回傳圖磚與點在拼圖中的位置。 */
export function miniMapTiles(latitude: number, longitude: number, zoom = ZOOM) {
  const { x, y } = worldPixel(latitude, longitude, zoom);
  const tileX = Math.floor(x / TILE);
  const tileY = Math.floor(y / TILE);
  const startX = x - tileX * TILE < TILE / 2 ? tileX - 1 : tileX;
  const startY = y - tileY * TILE < TILE / 2 ? tileY - 1 : tileY;
  const tiles = [0, 1].flatMap(dy => [0, 1].map(dx => ({ x: startX + dx, y: startY + dy, left: dx * TILE, top: dy * TILE })));
  return { tiles, pointX: x - startX * TILE, pointY: y - startY * TILE, zoom };
}

function metersPerPixel(latitude: number, zoom = ZOOM) {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * 卡片上的位置小地圖：只用真實定位，不放示意照片。
 * 位置未確認的建案不畫地圖，直接寫「位置未確認」，避免讓人以為在某個點。
 */
export default function ProjectMiniMap({ projectId, district }: { projectId: string; district: string }) {
  const location = locations[projectId]?.location;
  if (!location || location.confidence === 'estimated' || !Number.isFinite(location.latitude)) {
    return <div className="mini-map mini-map-unknown" aria-label="位置未確認"><span>{district}</span><small>位置未確認</small></div>;
  }
  const { tiles, pointX, pointY, zoom } = miniMapTiles(location.latitude, location.longitude);
  const approximate = location.confidence === 'low';
  // 只有官方道路範圍才有誤差半徑；其他概略位置不自己編一個公尺數。
  const radiusMeters = location.officialReference?.radiusMeters;
  const radiusPx = Math.max(14, Math.round((radiusMeters ?? 250) / metersPerPixel(location.latitude)));
  return <div className="mini-map" aria-label={`位置參考：${location.label || district}`}>
    {/* 位置圖磚來自 OpenStreetMap，與地圖頁同一來源；只載入 4 張 */}
    <div className="mini-map-tiles" style={{ left: `calc(50% - ${pointX}px)`, top: `calc(50% - ${pointY}px)` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 外部地圖圖磚，不經 next/image */}
      {tiles.map(tile => <img key={`${tile.x}-${tile.y}`} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} alt="" loading="lazy" decoding="async" width={256} height={256} style={{ left: tile.left, top: tile.top }} />)}
    </div>
    {approximate ? <span className="mini-map-area" style={{ width: radiusPx * 2, height: radiusPx * 2 }} /> : <span className="mini-map-pin" />}
    <small className="mini-map-label">{approximate ? (radiusMeters ? `概略位置・約 ${radiusMeters} 公尺內` : '概略位置') : '官方路口參考點'}</small>
    <small className="mini-map-credit">© OpenStreetMap</small>
  </div>;
}
