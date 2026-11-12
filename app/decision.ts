export type Needs = { budget: number; indoor: number; maxAge: number; elevator: boolean; destinationA: string; destinationB: string; commute: number };
export type Visit = { unit?: string; asking?: string; indoor?: string; completed?: string; elevator?: string; minutesA?: string; minutesB?: string; destinationA?: string; destinationB?: string; availability?: string; source?: string; date?: string; notes?: string; checked?: string[]; decision?: string };
export type Check = { key: string; label: string; state: 'pass' | 'fail' | 'unknown'; detail: string };
export function assessCandidate(needs: Needs, visit: Visit, today: string) {
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
  return { checks, status: checks.some(c => c.state === 'fail') ? 'fail' as const : checks.every(c => c.state === 'pass') ? 'pass' as const : 'unknown' as const };
}
