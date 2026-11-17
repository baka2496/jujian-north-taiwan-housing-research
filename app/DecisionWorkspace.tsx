"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import dataset from '@/data/processed/projects.json';
import { assessCandidate, compareByPrescreen, estimateLabels, prescreenCandidate, ASSUMED_PUBLIC_RATIO, type Needs, type Visit } from './decision';
import { displayBuilder, isMinorListing } from './catalogue';
import './decision.css';

const sinyiCity: Record<string, string> = { 臺北市: 'Taipei-city', 新北市: 'NewTaipei-city', 桃園市: 'Taoyuan-city', 新竹市: 'Hsinchu-city', 新竹縣: 'Hsinchu-county' };

type Project = (typeof dataset.projects)[number];
type Plan = { needs: Needs; city: string; district: string; saved: string[]; visits: Record<string, Visit>; archives?: { projectId: string; visit: Visit }[] };
const initial: Plan = { needs: { budget: 2000, indoor: 20, maxAge: 5, elevator: true, destinationA: '', destinationB: '', commute: 40 }, city: '新北市', district: '全部', saved: [], visits: {} };
const storageKey = 'jujian-decision-v1';
const labels = { unknown: '先補證據', fail: '條件不符', pass: '已填條件符合' };
const tasks = [
  ['sale', '先確認還有哪一戶可看', '問清楚戶別、含車位總價與可約看時間。'],
  ['space', '確認真正能使用的空間', '核對室內淨坪、電梯、完工日期；拍下尺寸與文件重點。'],
  ['route', '走一次平日的通勤路線', '記錄出門到目的地的總時間，包含步行與等待。'],
  ['condition', '看水痕、聽聲音、問維修', '檢查窗邊與天花板，觀察噪音；索取修繕與管理紀錄。'],
  ['cost', '補齊住進去之後的費用', '詢問管理費、車位費與已決議的公共修繕支出。'],
];
function localDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function restore(value: string): Plan {
  const data = JSON.parse(value);
  if (!data || typeof data !== 'object' || !data.needs || !Array.isArray(data.saved) || !data.visits || typeof data.visits !== 'object') throw new Error('invalid');
  const needs = { ...initial.needs };
  for (const key of ['budget', 'indoor', 'maxAge', 'commute'] as const) if (Number.isFinite(data.needs[key]) && data.needs[key] >= 0) needs[key] = data.needs[key];
  for (const key of ['destinationA', 'destinationB'] as const) if (typeof data.needs[key] === 'string') needs[key] = data.needs[key];
  if (typeof data.needs.elevator === 'boolean') needs.elevator = data.needs.elevator;
  const visits: Record<string, Visit> = {};
  for (const [id, raw] of Object.entries(data.visits)) {
    if (!raw || typeof raw !== 'object') continue;
    const record: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(raw)) if (typeof v === 'string') record[key] = v;
    if (Array.isArray((raw as Visit).checked)) record.checked = (raw as Visit).checked!.filter(v => typeof v === 'string');
    visits[id] = record as Visit;
  }
  return { needs, city: typeof data.city === 'string' ? data.city : initial.city, district: typeof data.district === 'string' ? data.district : '全部', archives: Array.isArray(data.archives) ? data.archives : [], saved: data.saved.filter((id: unknown) => typeof id === 'string' && dataset.projects.some(p => p.id === id)), visits };
}

export default function DecisionWorkspace({ onHistory }: { onHistory: (id?: string) => void }) {
  const [plan, setPlan] = useState<Plan>(initial);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [today, setToday] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'discover' | 'saved'>('discover');
  const [limit, setLimit] = useState(6);
  const [active, setActive] = useState<Project | null>(null);
  const [draft, setDraft] = useState<Visit>({});
  const [message, setMessage] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [reconfirmed, setReconfirmed] = useState(false);
  const [showExcluded, setShowExcluded] = useState(true);
  const [showOverEstimate, setShowOverEstimate] = useState(false);
  const [showMinor, setShowMinor] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => {
    setToday(localDate());
    try { const value = localStorage.getItem(storageKey); if (value) setPlan(restore(value)); }
    catch { setStorageError('無法讀取舊紀錄；本次操作仍可使用。'); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(storageKey, JSON.stringify(plan)); }
    catch { setStorageError('瀏覽器無法保存，請先匯出紀錄，避免關閉後遺失。'); }
  }, [plan, ready]);
  useEffect(() => {
    if (!active) return;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [active]);
  useEffect(() => {
    const refresh = () => setToday(localDate());
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.clearInterval(timer); };
  }, []);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 5000); return () => window.clearTimeout(timer); }, [message]);
  const cities = [...new Set(dataset.projects.map(p => p.city))];
  const districts = [...new Set(dataset.projects.filter(p => p.city === plan.city).map(p => p.district))].sort();
  const screened = useMemo(() => dataset.projects.filter(p =>
    (tab === 'saved' ? plan.saved.includes(p.id) : (plan.city === '全部' || p.city === plan.city) && (plan.district === '全部' || p.district === plan.district)) &&
    (!query || `${p.name}${p.district}${p.address}${p.builder}`.includes(query.trim())) && (showExcluded || plan.visits[p.id]?.decision !== '先排除')
  ).map(project => ({ project, prescreen: prescreenCandidate(plan.needs, project, today) })).sort(compareByPrescreen), [plan.city, plan.district, plan.saved, plan.visits, plan.needs, showExcluded, query, tab, today]);
  // 少於 10 戶或用地號當名稱的備查資料先收起；搜尋或「我的清單」時照常顯示
  const hideMinor = tab === 'discover' && !query.trim() && !showMinor;
  const minorCount = tab === 'discover' && !query.trim() ? screened.filter(s => isMinorListing(s.project)).length : 0;
  // 「我的清單」裡是使用者自己選的，不自動收起；探索時才先收起估計超出底線的候選。
  const hideOver = tab === 'discover' && !showOverEstimate;
  const overCount = screened.filter(s => s.prescreen.level === 'over').length;
  const visibleScreened = screened.filter(s => (!hideOver || s.prescreen.level !== 'over') && (!hideMinor || !isMinorListing(s.project)));
  const candidates = visibleScreened.map(s => s.project);
  const prescreenById = new Map(screened.map(s => [s.project.id, s.prescreen]));
  const withinCount = screened.filter(s => s.prescreen.level === 'within').length;
  const tightCount = screened.filter(s => s.prescreen.level === 'tight').length;
  const selected = dataset.projects.filter(p => plan.saved.includes(p.id));
  const assess = (p: Project) => assessCandidate(plan.needs, plan.visits[p.id] || {}, today, p);
  const failCount = candidates.filter(p => assess(p).status === 'fail').length;
  const needs = plan.needs;
  function need<K extends keyof Needs>(key: K, value: Needs[K]) { setPlan(p => ({ ...p, needs: { ...p.needs, [key]: value } })); }
  function toggle(id: string) { setPlan(p => ({ ...p, saved: p.saved.includes(id) ? p.saved.filter(x => x !== id) : [...p.saved, id] })); }
  function open(p: Project) {
    setReplacing(false); setReconfirmed(false);
    const saved = plan.visits[p.id] || {};
    setDraft({ ...saved, minutesA: saved.destinationA === needs.destinationA ? saved.minutesA : '', minutesB: saved.destinationB === needs.destinationB ? saved.minutesB : '' });
    setActive(p);
  }
  function field(key: keyof Visit, value: string) { setReconfirmed(false); setDraft(p => ({ ...p, [key]: value })); }
  function exportPlan() {
    const blob = new Blob([JSON.stringify({ ...plan, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '居鑑-選屋與看屋紀錄.json'; a.click(); URL.revokeObjectURL(url);
    setMessage('已匯出選屋條件與看屋紀錄');
  }
  function saveVisit() {
    if (!active) return;
    setToday(localDate());
    setPlan(p => ({ ...p, archives: replacing && p.visits[active.id] ? [...(p.archives || []), { projectId: active.id, visit: p.visits[active.id] }] : p.archives, visits: { ...p.visits, [active.id]: { ...draft, destinationA: needs.destinationA, destinationB: needs.destinationB } }, saved: p.saved.includes(active.id) ? p.saved : [...p.saved, active.id] }));
    setMessage(`${active.name} 的紀錄已更新，已重新檢查你的條件`);
    dialog.current?.close(); setActive(null);
  }
  return <div className="decision-workspace">
    <section className="decision-intro">
      <div className="decision-eyebrow"><span /> 給第一次買房的你 · 看屋前的功課</div>
      <div className="decision-intro-row"><div><h1>少看幾間，<br /><em>更接近適合的家。</em></h1><p>先說不能妥協的條件。把不適合的理由、<br className="desktop-break" />還沒確認的事，在出門看屋之前攤開。</p></div>
        <aside className="decision-principle"><span>居鑑的判斷原則</span><strong>不知道，就留白。</strong><p>不把歷史成交當成開價，<br />不把查無紀錄當成沒有問題。</p><div>有依據的取捨，比一個分數更有用。 <span>↗</span></div></aside>
      </div>
      <ol className="decision-steps"><li><b>01</b> 設定你的底線</li><li><b>02</b> 看懂取捨與缺口</li><li><b>03</b> 帶著問題去看屋</li></ol>
    </section>
    <div className="decision-layout">
      <aside className="decision-preferences"><div className="decision-section-label">01 / 我的底線</div><h2>先顧好不能妥協的。</h2><p className="decision-muted">條件隨時可改，判斷會一起更新。</p>
        <form onSubmit={e => { e.preventDefault(); resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
          <div className="decision-field-pair"><label>縣市<select value={plan.city} onChange={e => { setPlan(p => ({ ...p, city: e.target.value, district: '全部' })); setLimit(6); }}><option>全部</option>{cities.map(c => <option key={c}>{c}</option>)}</select></label><label>行政區<select value={plan.district} onChange={e => { setPlan(p => ({ ...p, district: e.target.value })); setLimit(6); }}><option>全部</option>{districts.map(d => <option key={d}>{d}</option>)}</select></label></div>
          <label>總預算上限 <span>含車位</span><div className="decision-unit"><input type="number" aria-label="總預算上限" min="1" max="100000" required value={needs.budget || ''} onChange={e => need('budget', Number(e.target.value))} /><span>萬元</span></div></label>
          <label>室內至少 <span>不含公設、車位</span><div className="decision-unit"><input type="number" aria-label="室內至少" min="1" max="1000" required value={needs.indoor || ''} onChange={e => need('indoor', Number(e.target.value))} /><span>坪</span></div></label>
          <label>屋齡需求<select value={needs.maxAge} onChange={e => need('maxAge', Number(e.target.value))}><option value="5">只考慮 5 年內成屋</option><option value="0">不限，預售屋也考慮</option></select></label>
          <label className="decision-checkbox"><input type="checkbox" checked={needs.elevator} onChange={e => need('elevator', e.target.checked)} /> 一定要有電梯</label>
          <details className="decision-commute"><summary>＋ 加入通勤底線{needs.destinationA || needs.destinationB ? '（已設定）' : ''}</summary><label>目的地 A<input placeholder="例如：台北車站" value={needs.destinationA} maxLength={100} onChange={e => need('destinationA', e.target.value)} /></label><label>目的地 B（選填）<input placeholder="另一位家人的上班地點" value={needs.destinationB} maxLength={100} onChange={e => need('destinationB', e.target.value)} /></label><label>每人單程最多（分鐘）<input type="number" min="1" max="300" value={needs.commute || ''} onChange={e => need('commute', Number(e.target.value))} /></label><small>先記錄目的地；路線時間需實測或補充來源，不用直線距離推算。</small></details>
          <button className="decision-primary" type="submit">查看候選與缺口 <span>↓</span></button>
        </form><p className="decision-storage">{storageError || '條件與紀錄只保存在這個瀏覽器。'}</p>
      </aside>
      <section className="decision-results" ref={resultRef}>
        <div className="decision-results-top"><div><div className="decision-section-label">02 / 看懂取捨</div><h2>{tab === 'saved' ? '你的看屋候選清單' : '先研究社區，再決定看哪一戶。'}</h2></div><button className="decision-text-button" onClick={exportPlan}>匯出紀錄 ↗</button></div>
        <div className="decision-disclosure"><span>i</span><p><strong>這裡是研究候選，還不是在售房源。</strong>政府資料更新至 {dataset.generatedAt.slice(0, 10)}。屋齡、電梯與當前可售戶要逐案確認。<a href={`https://www.sinyi.com.tw/buy/list/${sinyiCity[plan.city] || 'NewTaipei-city'}/presale/default-desc/1`} target="_blank" rel="noopener noreferrer">看信義房屋在售物件 ↗</a></p></div>
        <div className="decision-tabs" role="group" aria-label="候選範圍"><button aria-pressed={tab === 'discover'} onClick={() => { setTab('discover'); setQuery(''); setLimit(6); }}>探索候選</button><button aria-pressed={tab === 'saved'} onClick={() => { setTab('saved'); setQuery(''); setLimit(6); }}>我的清單 <b>{plan.saved.length}</b></button></div>
        <label className="decision-search"><span>⌕</span><input aria-label="搜尋候選社區" placeholder="搜尋社區、路段或建商" value={query} onChange={e => { setQuery(e.target.value); setLimit(6); }} />{query && <button aria-label="清除候選搜尋" onClick={() => setQuery('')}>×</button>}</label>
        <label className="decision-checkbox decision-excluded"><input type="checkbox" checked={showExcluded} onChange={e => setShowExcluded(e.target.checked)} /> 顯示我已排除的候選</label>
        <div className="decision-result-count"><span>{candidates.length} 個研究候選{failCount > 0 ? ` · ${failCount} 個條件不符` : ''}{withinCount + tightCount > 0 ? ` · ${withinCount} 個估計在預算內、${tightCount} 個接近上限` : ''}</span><span>依你的底線預估排序 · 非推薦排名</span></div>
        {overCount > 0 && tab === 'discover' && <div className="decision-over-note" role="status"><p>{hideOver ? `已先收起 ${overCount} 個估計超出底線的候選` : `含 ${overCount} 個估計超出底線的候選，排在最後`}<small>用歷史最低成交單價、室內 {needs.indoor} 坪與公設比 {Math.round(ASSUMED_PUBLIC_RATIO * 100)}% 估算，或首次登記已超過屋齡上限；不是開價。</small></p><button type="button" className="decision-text-button" aria-pressed={showOverEstimate} onClick={() => setShowOverEstimate(v => !v)}>{hideOver ? '仍要顯示' : '收起'}</button></div>}
        {minorCount > 0 && <div className="decision-minor-note"><span>{hideMinor ? `另有 ${minorCount} 個少於 10 戶或以地號命名的小案已收起` : `含 ${minorCount} 個少於 10 戶或以地號命名的小案`}</span><button type="button" className="decision-text-button" aria-pressed={showMinor} onClick={() => setShowMinor(v => !v)}>{hideMinor ? '顯示' : '收起'}</button></div>}
        <div className="decision-cards">{candidates.slice(0, limit).map((p, i) => {
          const result = assess(p); const record = plan.visits[p.id]; const failures = result.checks.filter(c => c.state === 'fail'); const gaps = result.checks.filter(c => c.state === 'unknown');
          const estimate = prescreenById.get(p.id) ?? prescreenCandidate(needs, p, today);
          const badgeClass = record?.decision === '先排除' ? 'fail' : result.status !== 'unknown' ? result.status : `estimate-${estimate.level}`;
          const badgeText = record?.decision === '先排除' ? '我已排除' : result.status !== 'unknown' ? labels[result.status] : estimateLabels[estimate.level];
          const verdictTitle = failures.length ? '先排除的理由' : result.status === 'pass' ? '下一步' : estimate.level === 'over' ? '估計不符合的地方' : estimate.level !== 'unknown' ? '依成交紀錄估算' : '出門前先確認';
          const verdictText = failures[0]?.detail || (result.status === 'unknown' && estimate.level !== 'unknown' ? estimate.short : '') || gaps[0]?.detail || '依你的紀錄符合已填條件，仍需現場確認屋況與交易文件。';
          return <article className={`decision-card ${result.status} estimate-${estimate.level}`} key={p.id}><div className="decision-card-head"><span className="decision-card-location">{p.city} / {p.district}</span><button aria-label={`${plan.saved.includes(p.id) ? '移出' : '加入'}清單：${p.name}`} aria-pressed={plan.saved.includes(p.id)} onClick={() => toggle(p.id)}>{plan.saved.includes(p.id) ? '✓ 已加入' : '＋ 加入清單'}</button></div><div className="decision-card-title"><h3>{p.name}</h3><span className={`decision-status ${badgeClass}`}>{badgeText}</span></div><p className="decision-address">{p.address || '地址待確認'} · {displayBuilder(p.builder)}</p>
            <div className="decision-evidence"><div><small>歷史成交中位單價</small><strong>{p.price ? <>{p.price.median}<span> 萬／坪</span></> : '尚無可用樣本'}</strong></div><p>{p.price ? <>{p.price.count} 筆成交<br />最新 {p.price.latestDate || '日期待補'}</> : <>樣本不足<br />無法判斷行情</>}</p></div>
            <div className="decision-verdict"><span>{verdictTitle}</span><p>{verdictText}</p><small>{failures.length ? `另有 ${gaps.length} 項待確認` : gaps.length ? `還有 ${gaps.length} 項要現場確認` : '依個人紀錄判斷，非平台驗證'}</small></div>
            {record?.decision && <p className="decision-personal">我的決定：{record.decision}</p>}
            <footer><button onClick={() => open(p)}>看屋清單 <span>→</span></button><button aria-label={`查看${p.name}詳細資料`} onClick={() => onHistory(p.id)}>價格、機能與品質</button></footer><span className="decision-card-index">{String(i + 1).padStart(2, '0')}</span>
          </article>;
        })}</div>
        {!candidates.length && <div className="decision-empty"><h3>{tab === 'saved' && !plan.saved.length ? '先留下值得研究的候選。' : '這個範圍還沒有候選。'}</h3><p>{tab === 'saved' && !plan.saved.length ? '在探索候選中加入清單，就能並排看取捨、保存看屋紀錄。' : '試試其他關鍵字或地區。沒有收錄，不代表當地沒有房子。'}</p><button onClick={() => { setQuery(''); setTab('discover'); setPlan(p => ({ ...p, city: '全部', district: '全部' })); }}>探索所有候選 →</button></div>}
        {candidates.length > limit && <button className="decision-more" onClick={() => setLimit(v => v + 6)}>再看 6 個候選 ↓</button>}
        {tab === 'saved' && selected.length >= 2 && <section className="decision-comparison"><h2>把取捨放在同一張桌上。</h2><p>橫向滑動比較。問號代表缺證據，不是符合。</p><div className="decision-table-scroll"><table><thead><tr><th>你的底線</th>{selected.map(p => <th key={p.id}>{p.name}</th>)}</tr></thead><tbody>{assessCandidate(needs, {}, today).checks.map(c => <tr key={c.key}><th>{c.label}</th>{selected.map(p => { const check = assess(p).checks.find(x => x.key === c.key)!; return <td key={p.id}><b className={check.state}>{check.state === 'unknown' ? '? 待確認' : check.state === 'fail' ? '× 不符合' : '✓ 符合紀錄'}</b><small>{check.detail}</small></td>; })}</tr>)}<tr><th>看屋後的決定</th>{selected.map(p => <td key={p.id}>{plan.visits[p.id]?.decision || '還沒決定'}</td>)}</tr></tbody></table></div></section>}
      </section>
    </div>
    <footer className="decision-footer"><strong>居鑑</strong><span>少一點猜測，多一點依據。</span><button onClick={() => onHistory()}>在地圖上看所有建案 →</button></footer>
    <div className="decision-announcement" role="status">{message}</div>
    {active && <dialog ref={dialog} className="decision-dialog" aria-labelledby="visit-heading" onCancel={() => setActive(null)} onClose={() => setActive(null)}><form onSubmit={e => { e.preventDefault(); saveVisit(); }}>
      <header><div><span className="decision-section-label">03 / 帶著問題去看屋</span><h2 id="visit-heading">{active.name}</h2><p>{active.city}・{active.district} · 一次記錄一個候選戶</p></div><button type="button" aria-label="關閉看屋紀錄" onClick={() => { dialog.current?.close(); setActive(null); }}>×</button></header>
      <div className="decision-dialog-body"><section><h3>現在還不能下結論的地方</h3><div className="decision-checks">{assess(active).checks.map(c => <div key={c.key}><span className={c.state}>{c.state === 'pass' ? '✓' : c.state === 'fail' ? '×' : '?'}</span><div><strong>{c.label}</strong><p>{c.detail}</p></div></div>)}</div><a className="decision-source-link" href={active.priceEvidence?.sourceUrl || 'https://data.gov.tw/dataset/176351'} target="_blank" rel="noreferrer">核對政府資料來源 ↗</a></section>
      <section><h3>這次看屋，帶著這 5 個問題</h3><p className="decision-muted">勾選只記錄你已問過，不代表條件自動符合。</p>{tasks.map(([key, title, description]) => <label className="decision-task" key={key}><input type="checkbox" checked={draft.checked?.includes(key) || false} onChange={e => setDraft(v => ({ ...v, checked: e.target.checked ? [...(v.checked || []), key] : (v.checked || []).filter(k => k !== key) }))} /><span><strong>{title}</strong><small>{description}</small></span></label>)}</section>
      <section><h3>補上你確認到的事</h3><p className="decision-muted">記錄來源與日期後才納入判斷。在售、開價與通勤紀錄超過 14 天會回到待確認。</p>
        <label>候選戶別<input readOnly={Boolean(plan.visits[active.id]) && !replacing} value={draft.unit || ''} onChange={e => field('unit', e.target.value)} placeholder="例如：A 棟 8 樓，避免混用不同戶資料" maxLength={100} /></label>
        <button type="button" className="decision-text-button" onClick={() => { setReplacing(true); setReconfirmed(false); setDraft({}); }}>改記另一戶（保存時會封存舊紀錄）</button>
        <div className="decision-field-pair"><label>確認來源<input value={draft.source || ''} onChange={e => field('source', e.target.value)} placeholder="例如：現場看屋、接待中心" maxLength={200} /></label><label>確認日期<input type="date" max={today} value={draft.date || ''} onChange={e => field('date', e.target.value)} /><button type="button" className="decision-text-button" onClick={() => field('date', localDate())}>填入今天</button></label></div>
        <div className="decision-field-pair"><label>含車位開價（萬元）<input type="number" min="1" step="any" value={draft.asking || ''} onChange={e => field('asking', e.target.value)} /></label><label>室內淨坪<input type="number" min="0.1" step="any" value={draft.indoor || ''} onChange={e => field('indoor', e.target.value)} /></label></div>
        <div className="decision-field-pair"><label>建築完成日期<input type="date" max={today} value={draft.completed || ''} onChange={e => field('completed', e.target.value)} /></label><label>可用電梯<select value={draft.elevator || ''} onChange={e => field('elevator', e.target.value)}><option value="">尚未確認</option><option value="yes">有</option><option value="no">沒有</option></select></label></div>
        <label>這一戶目前還在售嗎？<select value={draft.availability || ''} onChange={e => field('availability', e.target.value)}><option value="">尚未確認</option><option value="yes">已向銷售方確認在售</option><option value="no">已售出或停售</option></select></label>
        {(['A', 'B'] as const).filter(slot => needs[`destination${slot}`]).map(slot => <label key={slot}>到 {needs[`destination${slot}`]} 單程（分鐘）<input type="number" min="1" value={draft[`minutes${slot}`] || ''} onChange={e => field(`minutes${slot}`, e.target.value)} /></label>)}
        <label>觀察筆記<textarea rows={3} value={draft.notes || ''} onChange={e => field('notes', e.target.value)} placeholder="交通方式與時段、噪音、水痕、管理費，或還要追問的事…" maxLength={5000} /></label>
        <label>看完之後，我的決定<select value={draft.decision || ''} onChange={e => field('decision', e.target.value)}><option value="">還沒決定</option><option>值得再看</option><option>補完資料再決定</option><option>先排除</option></select></label>
        {draft.source?.trim() && draft.date && <label className="decision-checkbox"><input type="checkbox" required checked={reconfirmed} onChange={e => setReconfirmed(e.target.checked)} /> 我已在確認日期重新核對上面所有已填的物件資訊與通勤時間。</label>}
        <p className="decision-muted">可先保存筆記；沒有來源與日期的數值不會用來判定。封存的舊戶紀錄會包含在匯出檔案中。</p>
      </section></div><footer><span>只存於此瀏覽器，可匯出備份</span><button className="decision-primary" type="submit">保存紀錄，更新判斷 →</button></footer>
    </form></dialog>}
  </div>;
}
