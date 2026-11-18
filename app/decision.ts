export type Needs = { budget: number; indoor: number; maxAge: number; elevator: boolean; destinationA: string; destinationB: string; commute: number };
export type Visit = { unit?: string; asking?: string; indoor?: string; completed?: string; elevator?: string; minutesA?: string; minutesB?: string; destinationA?: string; destinationB?: string; availability?: string; source?: string; date?: string; notes?: string; checked?: string[]; decision?: string };
export type Check = { key: string; label: string; state: 'pass' | 'fail' | 'unknown'; detail: string };
export type ProjectFacts = { price?: { median: number; low: number; count: number } | null; firstRegistrationDate?: string | null };
export type EstimateLevel = 'within' | 'tight' | 'over' | 'unknown';
export type Prescreen = { level: EstimateLevel; rank: number; budget: { level: EstimateLevel; detail: string; short: string; total?: string }; age: { level: 'over' | 'unknown'; detail: string; short: string } | null; headline: string; short: string };

// 預估公設比：用來把「室內坪」換算成成交單價所用的「權狀坪」。新成屋多在 30–36%，取 33% 並寫在說明裡。
export const ASSUMED_PUBLIC_RATIO = 0.33;
export const MIN_PRICE_SAMPLES = 3;

function exact(value: number) {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(value);
}
function wan(value: number) {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(value / 10) * 10);
}

/**
 * 看屋前的預判：只用政府歷史成交與登記日期估算，不會讓候選「通過」任何條件，
 * 只會把「明顯超出底線」的候選往後排或先收起來。
 */
export function prescreenCandidate(needs: Needs, project: ProjectFacts, today: string): Prescreen {
  let budget: Prescreen['budget'] = { level: 'unknown', detail: '', short: '' };
  const price = project.price;
  if (!(needs.budget > 0 && needs.budget <= 100000 && needs.indoor > 0 && needs.indoor <= 1000)) {
    budget = { level: 'unknown', detail: '先填預算與室內坪數，才能用成交價估算總價', short: '' };
  } else if (!price || !(price.count >= MIN_PRICE_SAMPLES) || !(price.median > 0) || !(price.low > 0)) {
    budget = { level: 'unknown', detail: '成交樣本不足，無法估算總價', short: '' };
  } else {
    const registeredArea = needs.indoor / (1 - ASSUMED_PUBLIC_RATIO);
    const lowTotal = price.low * registeredArea;
    const medianTotal = price.median * registeredArea;
    const basis = `室內 ${needs.indoor} 坪約等於權狀 ${Math.round(registeredArea * 10) / 10} 坪（假設公設比 ${Math.round(ASSUMED_PUBLIC_RATIO * 100)}%），未含車位`;
    if (lowTotal > needs.budget) budget = { level: 'over', detail: `用歷史最低成交單價估算約 ${wan(lowTotal)} 萬起，已超過你的 ${exact(needs.budget)} 萬上限。${basis}`, short: `估算 ${wan(lowTotal)} 萬起，超過上限`, total: `${wan(lowTotal)} 萬起` };
    else if (medianTotal > needs.budget) budget = { level: 'tight', detail: `用歷史成交估算約 ${wan(lowTotal)}–${wan(medianTotal)} 萬，接近你的 ${exact(needs.budget)} 萬上限，可能只剩低樓層或小戶。${basis}`, short: `估算約 ${wan(lowTotal)}–${wan(medianTotal)} 萬，接近上限`, total: `約 ${wan(lowTotal)}–${wan(medianTotal)} 萬` };
    else budget = { level: 'within', detail: `用歷史成交中位數估算約 ${wan(medianTotal)} 萬，在你的 ${exact(needs.budget)} 萬上限內，車位要另外加。${basis}`, short: `估算約 ${wan(medianTotal)} 萬（不含車位）`, total: `約 ${wan(medianTotal)} 萬` };
  }
  let age: Prescreen['age'] = null;
  const registered = project.firstRegistrationDate;
  if (needs.maxAge > 0 && registered && /^\d{4}-\d{2}-\d{2}$/.test(registered) && /^\d{4}-\d{2}-\d{2}$/.test(today)) {
    const cutoff = new Date(today); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - needs.maxAge);
    // 首次登記一定晚於完工，所以首次登記已超過年限，完工只會更早。
    age = Date.parse(registered) < cutoff.getTime()
      ? { level: 'over', detail: `首次登記在 ${registered}，完工只會更早，已超過 ${needs.maxAge} 年`, short: `${registered.slice(0, 4)} 年已登記，超過 ${needs.maxAge} 年` }
      : { level: 'unknown', detail: `首次登記在 ${registered}；完工日期仍需確認`, short: '' };
  }
  const level: EstimateLevel = budget.level === 'over' || age?.level === 'over' ? 'over' : budget.level;
  const rank = { within: 0, tight: 1, unknown: 2, over: 3 }[level];
  const headline = age?.level === 'over' ? age.detail : budget.detail;
  const short = age?.level === 'over' ? age.short : budget.short;
  return { level, rank, budget, age, headline, short };
}

export const estimateLabels: Record<EstimateLevel, string> = { within: '估計在預算內', tight: '估計接近上限', over: '估計超出底線', unknown: '先補證據' };

/** 依預判排序：預算內 → 接近上限 → 無法估算 → 超出底線；同一層級最近有成交的排前面。 */
export function compareByPrescreen<T extends ProjectFacts & { name: string; price?: (ProjectFacts['price'] & { latestDate?: string | null }) | null }>(a: { project: T; prescreen: Prescreen }, b: { project: T; prescreen: Prescreen }) {
  return a.prescreen.rank - b.prescreen.rank
    || (b.project.price?.latestDate || '').localeCompare(a.project.price?.latestDate || '')
    || a.project.name.localeCompare(b.project.name, 'zh-TW');
}

export function assessCandidate(needs: Needs, visit: Visit, today: string, project?: ProjectFacts) {
  const checks: Check[] = [
    { key: 'availability', label: '目前在售', state: 'unknown', detail: '尚未取得當前可售戶的確認紀錄' },
    { key: 'budget', label: '總價', state: 'unknown', detail: '缺少含車位開價；歷史單價不能當成物件總價' },
    { key: 'indoor', label: '室內空間', state: 'unknown', detail: '需核對室內淨坪，不能用權狀坪數代替' },
  ];
  if (needs.maxAge) checks.push({ key: 'age', label: '屋齡', state: 'unknown', detail: '需建築完成日期；首次登記日期不能替代' });
  if (needs.elevator) checks.push({ key: 'elevator', label: '電梯', state: 'unknown', detail: '需確認這一戶可使用的電梯' });
  for (const [key, destination] of [['commuteA', needs.destinationA], ['commuteB', needs.destinationB]]) {
    if (destination.trim()) checks.push({ key, label: `通勤・${destination}`, state: 'unknown', detail: '需記錄尖峰時段、交通方式與門到門時間' });
  }
  const ageDays = (Date.parse(today) - Date.parse(visit.date || '')) / 86400000;
  const hasSource = Boolean(visit.source?.trim()) && Number.isFinite(ageDays) && ageDays >= 0;
  const set = (key: string, pass: boolean, detail: string) => {
    const check = checks.find(c => c.key === key);
    if (check) Object.assign(check, { state: pass ? 'pass' : 'fail', detail });
  };
  if (hasSource && ageDays <= 14) {
    if (visit.availability === 'yes') set('availability', true, '依你的近期確認紀錄仍在售，非平台即時驗證');
    if (visit.availability === 'no') set('availability', false, '你已記錄停售或售出');
    if (needs.budget > 0 && needs.budget <= 100000 && Number(visit.asking) > 0 && Number.isFinite(Number(visit.asking))) set('budget', Number(visit.asking) <= needs.budget, `紀錄開價 ${visit.asking} 萬（含車位）／上限 ${needs.budget} 萬`);
  }
  if (hasSource) {
    if (needs.indoor > 0 && needs.indoor <= 1000 && Number(visit.indoor) > 0 && Number.isFinite(Number(visit.indoor))) set('indoor', Number(visit.indoor) >= needs.indoor, `紀錄室內 ${visit.indoor} 坪／至少 ${needs.indoor} 坪`);
    if (visit.elevator === 'yes' || visit.elevator === 'no') set('elevator', visit.elevator === 'yes', visit.elevator === 'yes' ? '依你的紀錄可使用電梯' : '依你的紀錄無可用電梯');
    if (visit.completed && /^\d{4}-\d{2}-\d{2}$/.test(visit.completed) && Date.parse(visit.completed) <= Date.parse(today)) {
      const cutoff = new Date(today); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - needs.maxAge);
      set('age', Date.parse(visit.completed) >= cutoff.getTime(), `紀錄建築完成日期 ${visit.completed}／上限 ${needs.maxAge} 年`);
    }
    for (const slot of ['A', 'B'] as const) {
      const minutes = Number(visit[`minutes${slot}`]);
      if (needs.commute > 0 && needs.commute <= 300 && ageDays <= 14 && visit[`destination${slot}`] === needs[`destination${slot}`] && Number.isFinite(minutes) && minutes > 0) set(`commute${slot}`, minutes <= needs.commute, `紀錄單程 ${minutes} 分／上限 ${needs.commute} 分`);
    }
  }
  if (project) {
    // 還沒有親自確認的紀錄時，把預估寫進缺口說明，但狀態維持「待確認」，不會因估算而通過或淘汰。
    const estimate = prescreenCandidate(needs, project, today);
    const budgetCheck = checks.find(c => c.key === 'budget');
    if (budgetCheck?.state === 'unknown' && estimate.budget.level !== 'unknown') budgetCheck.detail = `${estimate.budget.detail}。仍需含車位開價確認。`;
    const ageCheck = checks.find(c => c.key === 'age');
    if (ageCheck?.state === 'unknown' && estimate.age) ageCheck.detail = estimate.age.detail;
  }
  return { checks, status: checks.some(c => c.state === 'fail') ? 'fail' as const : checks.every(c => c.state === 'pass') ? 'pass' as const : 'unknown' as const };
}
