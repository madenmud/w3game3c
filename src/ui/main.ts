import '../style.css';
import { FACTIONS, FACTION_IDS, ITEMS, MISSIONS, PROFILE_PRESETS, ROUNDS, SEASON_MONTHS, STAT_LABEL, STAT_TOTAL, TASKS, TASK_IDS, TRAIT_TREE } from '../engine/data';
import * as G from '../engine/game';
import { effectiveStats, fitnessTier, heuBonus } from '../engine/rules';
import { STATS, type Activity, type FactionId, type GameState, type Stat, type TaskId } from '../engine/types';

const SAVE_KEY = 'w3game3c-save-v1';
type Tab = 'home' | 'team' | 'hire' | 'growth' | 'invest' | 'shop' | 'faction' | 'log';

let state: GameState = load() ?? G.newGame(randomSeed());
let tab: Tab = 'home';
let toast: string | null = null;
let foundName = '';
let foundFaction: FactionId = 'north';
let nameSuggestion = 0;

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (s.version !== 1) return null;
    // 이전 저장본에는 크런치 누적·광고 예산이 없다
    if (s.company) { s.company.crunchMonths ??= 0; s.company.adBudget ??= 0; }
    return s;
  } catch {
    return null;
  }
}

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* 저장 불가 환경은 무시 */ }
}

function set(next: GameState, msg?: string) {
  state = next;
  if (msg) toast = msg;
  save();
  render();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = G.fmtMoney;
const r0 = (n: number) => Math.round(n);

function bar(value: number, max = 100, tone = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="bar ${tone}"><span style="width:${pct}%"></span></span>`;
}

function activityValue(a: Activity): string {
  return a.kind === 'study' ? `study:${a.stat}` : a.kind;
}

function parseActivity(v: string): Activity {
  if (v.startsWith('study:')) return { kind: 'study', stat: v.slice(6) as Stat };
  return { kind: v as 'rest' | 'side' | 'network' };
}

// ---------------- 화면 ----------------

function render() {
  const app = document.getElementById('app')!;
  let body = '';
  if (state.phase === 'create') body = renderCreate();
  else if (state.phase === 'found') body = renderFound();
  else if (state.phase === 'ended') body = renderEnded();
  else body = renderPlay();
  app.innerHTML = `
    <header class="top">
      <div class="brand">테크 삼국지 <span class="tag">MVP</span></div>
      <button class="ghost small" data-act="reset">새 게임</button>
    </header>
    ${toast ? `<div class="toast" role="status">${esc(toast)}</div>` : ''}
    ${body}
    <footer class="foot">체험판입니다. 실제 서비스에서는 하루가 게임의 한 달이고, 매일 09:00에 자동 정산됩니다. 외부 연동(프로필, HEU, 운동, 코인 결제)은 모두 목업입니다. 저장은 이 브라우저에만 됩니다.</footer>
  `;
  toast = null;
}

function statEditor(): string {
  const st = state.player.stats;
  return `<div class="stats-edit">${STATS.map((s) => `
    <div class="stat-row">
      <span class="stat-name">${STAT_LABEL[s]}</span>
      ${bar(st[s])}
      <span class="num">${r0(st[s])}</span>
      <span class="btns">
        <button class="small" data-act="stat-down" data-arg="${s}" aria-label="${STAT_LABEL[s]} 내리기">−</button>
        <button class="small" data-act="stat-up" data-arg="${s}" aria-label="${STAT_LABEL[s]} 올리기">+</button>
      </span>
    </div>`).join('')}
    <p class="hint">총합은 ${STAT_TOTAL}로 고정이에요. +를 누르면 가장 높은 다른 능력치에서 1점을 가져와요.</p>
  </div>`;
}

function renderCreate(): string {
  const p = state.player;
  const tier = fitnessTier(p.exerciseDaysPerWeek);
  return `
  <main class="wrap">
    <section class="card">
      <h1>아바타 만들기</h1>
      <p class="lead">실제 프로필은 능력치의 '모양'만 정하고, 이름과 경력은 모두 가상으로 만들어요.</p>
      <label class="field">아바타 이름
        <input id="avatar-name" value="${esc(p.name)}" maxlength="12" />
      </label>
      <h2>프로필 연동 <span class="mock">목업</span></h2>
      <div class="chips">${Object.entries(PROFILE_PRESETS).map(([id, pr]) => `
        <button class="chip ${p.linkedProfile === id ? 'on' : ''}" data-act="preset" data-arg="${id}">${pr.source === '연동 없음' ? pr.label : `${pr.source} 연동 → ${pr.label}`}</button>`).join('')}
      </div>
      ${statEditor()}
    </section>
    <section class="card">
      <h2>heurist 특별룰 <span class="mock">목업</span></h2>
      <p class="hint">실제로는 지갑 서명 한 번으로 주소를 증명하고, 서버가 HEU 잔고를 읽기만 해요. 여기서는 보유량을 직접 넣어 보세요.</p>
      <label class="field">보유 HEU
        <input id="heu" type="number" min="0" step="1000" value="${p.heuBalance}" />
      </label>
      <p>AI·지식 가산: <b>+${heuBonus(p.heuBalance).toFixed(1)}</b> (상한 +12)</p>
    </section>
    <section class="card">
      <h2>운동 연동 <span class="mock">목업</span></h2>
      <p class="hint">Garmin·Strava 연동 시 최근 4주의 주별 운동 일수만 읽어요. 주 3일 이상인 주가 많을수록 체력이 오르고, 강도는 보지 않아요.</p>
      <div class="weeks">${[0, 1, 2, 3].map((i) => `
        <label>${i + 1}주 전<input class="ex" data-week="${i}" type="number" min="0" max="7" value="${p.exerciseDaysPerWeek[3 - i] ?? 0}" /></label>`).join('')}
      </div>
      <p>체력 단계: <b>${tier} / 3</b> ${tier ? `(과로 피로 -${tier * 2}/월, 성장 효율 +${(tier / 3 * 10).toFixed(0)}%)` : ''}</p>
    </section>
    <div class="actions"><button class="primary" data-act="finish-avatar">이 아바타로 시작</button></div>
  </main>`;
}

function renderFound(): string {
  if (!foundName) foundName = G.suggestCompanyName(state, nameSuggestion);
  return `
  <main class="wrap">
    <section class="card">
      <h1>창업하기</h1>
      <label class="field">회사 이름
        <span class="row"><input id="company-name" value="${esc(foundName)}" maxlength="20" /><button class="small" data-act="suggest-name">추천</button></span>
      </label>
      <h2>제휴할 진영</h2>
      <p class="hint">시장은 가상의 세 거대 진영이 나눠 갖고 있어요. 제휴하면 혜택을 받고, 시즌 말 진영 순위에도 기여해요.</p>
      <div class="factions">${FACTION_IDS.map((f) => `
        <button class="faction ${f} ${foundFaction === f ? 'on' : ''}" data-act="pick-faction" data-arg="${f}">
          <b>${FACTIONS[f].name}</b><span>${FACTIONS[f].tagline}</span><em>${FACTIONS[f].perk}</em>
        </button>`).join('')}
      </div>
      <p class="hint">시작 자금 ${money(G.START_CASH)}. 현금이 두 달 연속 0 아래면 파산해요.</p>
    </section>
    <div class="actions"><button class="ghost" data-act="back-create">아바타 수정</button><button class="primary" data-act="found">창업</button></div>
  </main>`;
}

function renderPlay(): string {
  const co = state.company!;
  const tabs: [Tab, string][] = [['home', '현황'], ['team', '팀·업무'], ['hire', `채용${state.candidates.length ? ` ${state.candidates.length}` : ''}`], ['growth', '성장'], ['invest', `투자${state.offers.length ? ' •' : ''}`], ['shop', '상점'], ['faction', '진영'], ['log', '기록']];
  const content = { home: renderHome, team: renderTeam, hire: renderHire, growth: renderGrowth, invest: renderInvest, shop: renderShop, faction: renderFaction, log: renderLog }[tab]();
  const ev = state.lastEvent;
  return `
  <div class="status">
    <div><span class="k">${esc(co.name)}</span><span class="v">${state.month + 1}개월차 / ${SEASON_MONTHS}</span></div>
    <div><span class="k">현금 · 런웨이 ${runwayText(co)}</span><span class="v ${co.cash < 0 ? 'neg' : ''}">${money(co.cash)}</span></div>
    <div><span class="k">MRR</span><span class="v">${money(co.mrr)}</span></div>
    <div><span class="k">가치</span><span class="v">${money(G.valuation(co, state.player.traits))}</span></div>
  </div>
  ${ev ? `<div class="event"><b>이번 달 사건 · ${esc(ev.title)}</b> ${esc(ev.text)}</div>` : ''}
  <nav class="tabs" role="tablist">${tabs.map(([t, l]) => `<button role="tab" aria-selected="${tab === t}" class="${tab === t ? 'on' : ''}" data-act="tab" data-arg="${t}">${l}</button>`).join('')}</nav>
  <main class="wrap">${content}</main>
  <div class="advance">
    <button class="primary big" data-act="advance">한 달 진행하고 정산</button>
  </div>`;
}

function runwayText(co: NonNullable<GameState['company']>): string {
  const r = G.runwayMonths(co);
  return Number.isFinite(r) ? `${Math.floor(r)}개월` : '흑자';
}

function renderHome(): string {
  const co = state.company!;
  const p = state.player;
  const rep = state.lastReport;
  const runway = G.runwayMonths(co);
  const card = state.mission ? MISSIONS.find((m) => m.id === state.mission!.cardId) : null;
  return `
  ${noRevenueTask(co) ? `<section class="card warn-card"><b>매출을 만드는 사람이 없어요.</b> 매출은 마케팅(사용자)과 영업(B2B), 광고 예산에서 나와요. '팀·업무'에서 나나 직원 한 명을 마케팅이나 영업에 배정해 보세요.</section>` : ''}
  ${runway < 4 ? `<section class="card warn-card"><b>현금이 ${Math.floor(runway)}개월치 남았어요.</b> 매출은 마케팅(사용자)과 영업(B2B)에서 나와요. 투자 탭의 다음 라운드 조건을 확인하거나, 비용을 줄이세요.</section>` : ''}
  ${p.pendingTraitChoice ? renderTraitChoice() : ''}
  <section class="card">
    <h2>오늘의 학습 카드 <span class="hint-inline">맞히면 이번 달 내 성과 +20%, 팀 성과 +10%, 성장 효율 +20%</span></h2>
    ${card ? `<p class="q">${esc(card.q)}</p>
      <div class="choices">${card.choices.map((c, i) => {
        const m = state.mission!;
        const cls = m.answered ? (i === card.answer ? 'right' : '') : '';
        return `<button class="choice ${cls}" data-act="answer" data-arg="${i}" ${m.answered ? 'disabled' : ''}>${esc(c)}</button>`;
      }).join('')}</div>
      ${state.mission!.answered ? `<p class="${state.mission!.correct ? 'good' : 'bad'}">${state.mission!.correct ? '정답! 이번 달 보너스가 적용돼요.' : '오답이에요. 2개월 뒤에 다시 나와요.'}</p>` : ''}` : '<p>카드 없음</p>'}
  </section>
  <section class="card grid2">
    <div><h3>제품 완성도</h3>${bar(co.product)} <span class="num">${r0(co.product)}</span></div>
    <div><h3>사용자</h3><span class="big-num">${co.users.toLocaleString()}</span></div>
    <div><h3>브랜드</h3>${bar(co.brand)} <span class="num">${r0(co.brand)}</span></div>
    <div><h3>조직 분위기</h3>${bar(co.culture)} <span class="num">${r0(co.culture)}</span></div>
    <div><h3>내 피로</h3>${bar(p.fatigue, 100, p.fatigue > 60 ? 'warn' : '')} <span class="num">${r0(p.fatigue)}</span></div>
    <div><h3>지분</h3><span class="big-num">${(co.ownership * 100).toFixed(1)}%</span> <span class="hint-inline">${ROUNDS[co.roundIndex]!.name}</span></div>
  </section>
  ${rep ? `<section class="card">
    <h2>지난달 정산</h2>
    <p>매출 ${money(rep.revenue)} · 비용 ${money(rep.costs)} · 현금 ${rep.cashDelta >= 0 ? '+' : ''}${money(rep.cashDelta)} · 사용자 ${rep.usersDelta >= 0 ? '+' : ''}${rep.usersDelta}</p>
    <table class="tbl"><thead><tr><th>누가</th><th>업무</th><th>성과</th></tr></thead><tbody>
      ${rep.outputs.map((o) => `<tr><td>${esc(o.who)}</td><td>${TASKS[o.task].label}</td><td>${o.output.toFixed(1)}</td></tr>`).join('')}
    </tbody></table>
    ${rep.growth.length ? `<p>성장: ${rep.growth.map((g) => `${STAT_LABEL[g.stat]} +${g.delta.toFixed(2)}`).join(', ')}</p>` : ''}
    ${rep.resigned.length ? `<p class="bad">퇴사: ${rep.resigned.map(esc).join(', ')}</p>` : ''}
  </section>` : `<section class="card"><h2>시작 가이드</h2><ol class="guide">
    <li>'채용'에서 후보를 면접하고 제안을 보내세요.</li>
    <li>'팀·업무'에서 나와 직원에게 업무를 배정하세요.</li>
    <li>'성장'에서 이번 달 개인 스케줄 3칸을 정하세요.</li>
    <li>위의 학습 카드를 풀고, 아래 버튼으로 한 달을 진행하세요.</li>
  </ol></section>`}
  ${co.history.length > 1 ? renderChart() : ''}`;
}

function noRevenueTask(co: NonNullable<GameState['company']>): boolean {
  const revenue: TaskId[] = ['marketing', 'sales'];
  return !revenue.includes(co.playerTask) && !co.employees.some((e) => revenue.includes(e.task)) && co.adBudget <= 0;
}

function renderChart(): string {
  const h = state.company!.history;
  const w = 320, ht = 90;
  const maxV = Math.max(...h.map((x) => x.mrr), 1);
  const pts = h.map((x, i) => `${(i / Math.max(1, h.length - 1)) * w},${ht - (x.mrr / maxV) * (ht - 10)}`).join(' ');
  return `<section class="card"><h2>MRR 추이</h2>
    <svg viewBox="0 0 ${w} ${ht}" class="chart" role="img" aria-label="MRR 추이"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2"/></svg>
    <p class="hint">최고 ${money(maxV)}</p></section>`;
}

function taskSelect(who: string, current: TaskId): string {
  return `<select data-input="task" data-arg="${esc(who)}">${TASK_IDS.map((t) => `<option value="${t}" ${t === current ? 'selected' : ''}>${TASKS[t].label}</option>`).join('')}</select>`;
}

function renderTeam(): string {
  const co = state.company!;
  const p = state.player;
  const eff = effectiveStats(p);
  return `
  <section class="card">
    <h2>근무 강도</h2>
    <div class="chips">
      <button class="chip ${co.intensity === 'normal' ? 'on' : ''}" data-act="intensity" data-arg="normal">보통</button>
      <button class="chip ${co.intensity === 'crunch' ? 'on' : ''}" data-act="intensity" data-arg="crunch">크런치</button>
    </div>
    <p class="hint">크런치는 처음 ${G.CRUNCH_GRACE_MONTHS}개월 동안 성과 +20%예요. 더 이어지면 번아웃으로 성과 보너스가 매달 줄고(최저 -20%) 만족도와 분위기가 더 빨리 떨어져요. 보통으로 돌아오면 번아웃이 매달 2씩 풀려요.</p>
    ${co.crunchMonths > G.CRUNCH_GRACE_MONTHS ? `<p class="bad">번아웃 ${co.crunchMonths - G.CRUNCH_GRACE_MONTHS}단계 · 다음 달도 크런치면 성과 ×${G.crunchOutputMult(co.crunchMonths + 1).toFixed(1)}</p>` : co.crunchMonths > 0 ? `<p class="hint">크런치 누적 ${co.crunchMonths}개월</p>` : ''}
  </section>
  <section class="card">
    <h2>광고 예산</h2>
    <p class="hint">매달 이 금액을 써서 사용자를 사요. 예산이 클수록 1명당 단가가 올라요. 투자금을 성장으로 바꾸는 가장 빠른 길이에요. 현금이 모자라면 남은 현금만큼만 써요.</p>
    <label class="inline">월 광고 예산(달러) <input data-input="ad-budget" type="number" min="0" max="${G.AD_BUDGET_MAX}" step="500" value="${co.adBudget}" /></label>
    <span class="hint-inline">예상 신규 사용자 약 ${Math.round(G.adUsers(co.adBudget, co.product)).toLocaleString()}명/월</span>
  </section>
  <section class="card">
    <h2>업무가 바꾸는 것</h2>
    <table class="tbl"><tbody>${TASK_IDS.map((t) => `<tr><td>${TASKS[t].label}</td><td class="hint">${STAT_LABEL[TASKS[t].main]} 중심 · ${TASKS[t].effect}</td></tr>`).join('')}</tbody></table>
    <p class="hint">매출은 마케팅(사용자 × 완성도), 영업(B2B), 광고 예산에서 나와요. 제품 완성도가 낮으면 모두 약해요. AI 기능은 객단가를 최대 50% 올려요. 한 업무에 여러 명을 몰면 효과가 체감하니 고르게 나누세요.</p>
  </section>
  <section class="card">
    <h2>나 (오너)</h2>
    <div class="member">
      <div><b>${esc(p.name)}</b> <span class="hint-inline">급여 없음</span></div>
      ${taskSelect('player', co.playerTask)}
    </div>
    <div class="mini-stats">${STATS.map((s) => `<span>${STAT_LABEL[s]} <b>${r0(eff[s])}</b>${eff[s] !== p.stats[s] ? `<i>(+${r0(eff[s] - p.stats[s])})</i>` : ''}</span>`).join('')}</div>
  </section>
  <section class="card">
    <h2>직원 ${co.employees.length}/${G.MAX_EMPLOYEES}</h2>
    ${co.employees.length ? co.employees.map((e) => `
      <div class="member">
        <div><b>${esc(e.name)}</b> <span class="hint-inline">만족도</span> ${bar(e.satisfaction, 100, e.satisfaction < 35 ? 'warn' : '')} <span class="num">${r0(e.satisfaction)}</span></div>
        ${taskSelect(e.id, e.task)}
        <div class="mini-stats">${STATS.map((s) => `<span>${STAT_LABEL[s]} <b>${r0(e.stats[s])}</b></span>`).join('')}</div>
        <div class="row">
          <label class="inline">월급 <input class="salary" data-input="salary" data-arg="${e.id}" type="number" step="50" min="${G.salaryFloor(e.stats)}" value="${e.salary}" /></label>
          <span class="hint-inline">시장가 ${money(G.askingSalary(e.stats))} · 하한 ${money(G.salaryFloor(e.stats))} · 깎으면 만족도가 바로 떨어져요</span>
          <button class="ghost small danger" data-act="fire" data-arg="${e.id}">내보내기</button>
        </div>
      </div>`).join('') : '<p class="hint">아직 직원이 없어요. 채용 탭에서 후보를 만나 보세요.</p>'}
  </section>`;
}

function rangeCell(lo: number, hi: number): string {
  return `<span class="range"><span class="rbar" style="left:${lo}%;width:${Math.max(2, hi - lo)}%"></span></span><span class="num small">${lo}~${hi}</span>`;
}

function renderHire(): string {
  const err = G.delegatedInterviewError(state);
  return `
  <section class="card">
    <h2>후보</h2>
    <p class="hint">진짜 능력치는 숨겨져 있고 추정 범위만 보여요. 실시간 면접은 질문 3개로 원하는 능력치를 ±3까지 좁히고, 위임 면접은 채용 담당의 리더십에 따라 전체를 ±${err}로 좁혀요. 후보는 3개월마다 바뀌어요.</p>
  </section>
  ${state.candidates.length ? state.candidates.map((c) => `
  <section class="card cand">
    <div class="row between"><b>${esc(c.name)}</b><span class="hint-inline">희망 월급 ${money(c.ask)}</span></div>
    <div class="cand-stats">${STATS.map((s) => `<div class="cs"><span class="stat-name">${STAT_LABEL[s]}</span>${rangeCell(c.estimate[s].lo, c.estimate[s].hi)}
      ${c.liveProbesLeft > 0 ? `<button class="tiny" data-act="probe" data-arg="${c.id}|${s}" title="이 능력치를 실시간 면접으로 확인">질문</button>` : ''}</div>`).join('')}</div>
    <div class="row wrap-row">
      <span class="hint-inline">실시간 질문 ${c.liveProbesLeft}회 남음</span>
      <button class="small" data-act="delegate" data-arg="${c.id}" ${c.interviewed === 'delegated' ? 'disabled' : ''}>위임 면접</button>
    </div>
    <div class="row wrap-row">
      <label class="inline">제안 월급 <input id="offer-${c.id}" type="number" step="50" value="${c.ask}" /></label>
      ${taskSelect(`offer-${c.id}`, G.bestTaskFor(midStats(c.estimate)))}
      <button class="primary small" data-act="offer" data-arg="${c.id}">제안 보내기</button>
    </div>
  </section>`).join('') : '<section class="card"><p>지금은 후보가 없어요. 3개월마다 새 후보가 오고, 네트워킹을 하면 더 와요.</p></section>'}`;
}

function midStats(est: GameState['candidates'][number]['estimate']) {
  const o = {} as Record<Stat, number>;
  for (const s of STATS) o[s] = (est[s].lo + est[s].hi) / 2;
  return o;
}

function activitySelect(slot: number, a: Activity): string {
  const opts: [string, string][] = [
    ...STATS.map((s) => [`study:${s}`, `수업: ${STAT_LABEL[s]}`] as [string, string]),
    ['rest', '휴식·운동 (피로 -30)'], ['side', '부업 (개인 자금 +$400)'], ['network', '네트워킹 (후보 +2)'],
  ];
  return `<select data-input="schedule" data-arg="${slot}">${opts.map(([v, l]) => `<option value="${v}" ${v === activityValue(a) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

function renderTraitChoice(): string {
  const pend = state.player.pendingTraitChoice!;
  const node = TRAIT_TREE.find((t) => t.stat === pend.stat && t.threshold === pend.threshold)!;
  return `<section class="card highlight"><h2>특성 선택: ${STAT_LABEL[pend.stat]} ${pend.threshold}</h2>
    <div class="factions">${node.options.map((o) => `<button class="faction" data-act="trait" data-arg="${o.id}"><b>${o.name}</b><em>${o.desc}</em></button>`).join('')}</div></section>`;
}

function renderGrowth(): string {
  const p = state.player;
  const tier = fitnessTier(p.exerciseDaysPerWeek);
  const traitNames = p.traits.map((id) => TRAIT_TREE.flatMap((t) => t.options).find((o) => o.id === id)?.name ?? id);
  return `
  ${p.pendingTraitChoice ? renderTraitChoice() : ''}
  <section class="card">
    <h2>이번 달 개인 스케줄</h2>
    <p class="hint">수업 1칸은 피로 +15, 휴식은 -30이에요. 업무로 매달 피로가 쌓이고 자연 회복이 있어요. 피로가 60을 넘으면 수업 효율이 절반, 80을 넘으면 다음 달 첫 칸이 강제 휴식이에요. 수업 2칸 + 휴식 1칸이 오래 가는 리듬이에요.</p>
    ${[0, 1, 2].map((i) => `<label class="field">${i + 1}칸 ${i === 0 && p.forcedRest ? '<span class="bad">(강제 휴식)</span>' : ''}${activitySelect(i, p.schedule[i as 0 | 1 | 2])}</label>`).join('')}
    <p>피로 ${bar(p.fatigue, 100, p.fatigue > 60 ? 'warn' : '')} <span class="num">${r0(p.fatigue)}</span> · 체력 ${tier}/3 · 개인 자금 ${money(p.personalCash)}</p>
  </section>
  <section class="card">
    <h2>능력치</h2>
    ${STATS.map((s) => `<div class="stat-row"><span class="stat-name">${STAT_LABEL[s]}</span>${bar(p.stats[s])}<span class="num">${p.stats[s].toFixed(1)}</span></div>`).join('')}
    <p class="hint">능력치가 높을수록 성장이 느려져요(ΔS = 0.4 × (1 − S/120) × 효율). 75에 닿으면 특성을 고를 수 있고, 특성은 최대 3개예요.</p>
    <p>특성: ${traitNames.length ? traitNames.map(esc).join(', ') : '없음'}</p>
  </section>`;
}

function renderInvest(): string {
  const co = state.company!;
  const next = ROUNDS[co.roundIndex + 1];
  return `
  <section class="card">
    <h2>현재 라운드: ${ROUNDS[co.roundIndex]!.name}</h2>
    <p>지분 ${(co.ownership * 100).toFixed(1)}% · 회사 가치 ${money(G.valuation(co, state.player.traits))} · IR 점수 ${r0(co.irScore)} · 성장 웃돈 +${r0(G.growthPremium(co) * 100)}%</p>
    <p class="hint">회사 가치에는 보유 현금이 들어가요. VC는 최근 3개월 MRR 성장률만큼(최대 +60%) 웃돈을 얹어 줘요. 받은 투자금은 채용과 광고 예산으로 성장에 써야 지분을 내준 값을 해요.</p>
    ${next ? `<p class="hint">다음 라운드 ${next.name} 조건: MRR ${money(next.minMrr)} 이상, 제품 완성도 ${next.minProduct} 이상 (지금 ${money(co.mrr)}, ${r0(co.product)}). 재무 업무는 IR 점수를 올려 밸류에이션을 높여요.</p>` : '<p>모든 라운드를 마쳤어요.</p>'}
  </section>
  ${state.offers.map((o) => `
  <section class="card highlight">
    <h2>${ROUNDS[o.round]!.name} 제안 · ${esc(o.investor)}</h2>
    <p>투자금 <b>${money(o.amount)}</b> · 프리머니 ${money(o.preMoney)} · 내줄 지분 ${((o.amount / (o.preMoney + o.amount)) * 100).toFixed(1)}%</p>
    <p class="hint">${o.expiresMonth + 1}개월차까지 유효</p>
    <div class="row"><button class="primary" data-act="accept-offer" data-arg="${o.round}">수락</button><button class="ghost" data-act="decline-offer" data-arg="${o.round}">거절</button></div>
  </section>`).join('')}`;
}

function renderShop(): string {
  const p = state.player;
  const w = G.wearInfo(p);
  return `
  <section class="card">
    <h2>상점 <span class="mock">테스트 결제</span></h2>
    <p class="hint">실제 서비스에서는 USDC(Base)로 결제하고, 지갑은 결제하는 순간에만 써요. 아이템은 거래할 수 없고 랜덤박스는 없어요.</p>
    <p>착용 포인트 <b>${w.used}/${w.limit}</b> (경력 6개월마다 +1, 최대 14) · 장비 슬롯 4칸 · 능력치당 외부 가산 상한 +15</p>
    <label class="inline">월 결제 한도(달러) <input data-input="spend-limit" type="number" min="0" max="500" value="${p.monthlySpendLimitUsd}" /></label>
    <span class="hint-inline">이번 달 사용 ${p.spentThisMonthUsd}달러</span>
  </section>
  ${ITEMS.map((it) => {
    const owned = p.inventory.includes(it.id);
    const on = p.equipped.includes(it.id);
    return `<section class="card item">
      <div class="row between"><b>${esc(it.name)}</b><span>${it.priceUsd} USDC</span></div>
      <p class="hint">${it.kind === 'gear' ? `${STAT_LABEL[it.stat]} +${it.bonus} (착용 포인트 ${it.bonus})` : '꾸미기 아이템, 능력치 효과 없음'}</p>
      <div class="row">${!owned ? `<button class="small" data-act="buy" data-arg="${it.id}">테스트 결제로 구매</button>` : on ? `<button class="small ghost" data-act="unequip" data-arg="${it.id}">해제</button>` : `<button class="small primary" data-act="equip" data-arg="${it.id}">착용</button>`}</div>
    </section>`;
  }).join('')}`;
}

function renderFaction(): string {
  const sc = G.factionScores(state);
  const max = Math.max(...Object.values(sc));
  const co = state.company!;
  const order = [...FACTION_IDS].sort((a, b) => sc[b] - sc[a]);
  return `
  <section class="card">
    <h2>진영 패권</h2>
    <p class="hint">진영 점수 = 제휴 회사 가치의 합. 시즌이 끝나면 1위 진영의 제휴사 전원이 칭호를 받아요.</p>
    ${order.map((f, i) => `<div class="stat-row"><span class="stat-name">${i + 1}. ${FACTIONS[f].name}${f === co.faction ? ' (내 진영)' : ''}</span>${bar(sc[f], max, f)}<span class="num">${money(sc[f])}</span></div>`).join('')}
  </section>
  <section class="card">
    <h2>경쟁사</h2>
    <table class="tbl"><thead><tr><th>회사</th><th>진영</th><th>가치</th></tr></thead><tbody>
      ${[...state.rivals, { id: 'me', name: `${co.name} (나)`, faction: co.faction, valuation: G.valuation(co, state.player.traits), momentum: 0 }]
        .sort((a, b) => b.valuation - a.valuation)
        .map((r) => `<tr class="${r.id === 'me' ? 'me' : ''}"><td>${esc(r.name)}</td><td>${FACTIONS[r.faction].name.split(' ')[0]}</td><td>${money(r.valuation)}</td></tr>`).join('')}
    </tbody></table>
  </section>`;
}

function renderLog(): string {
  return `<section class="card"><h2>기록</h2><ul class="log">${[...state.log].reverse().map((l) => `<li class="${l.tone ?? ''}"><span class="m">${l.month + 1}월</span> ${esc(l.text)}</li>`).join('')}</ul></section>`;
}

function renderEnded(): string {
  const co = state.company;
  const sc = G.factionScores(state);
  const top = [...FACTION_IDS].sort((a, b) => sc[b] - sc[a])[0]!;
  const bankrupt = state.endReason === 'bankrupt';
  return `
  <main class="wrap">
    <section class="card highlight">
      <h1>${bankrupt ? '파산' : '시즌 종료'}</h1>
      ${co ? `<p>${esc(co.name)} · ${state.month}개월 · ${ROUNDS[co.roundIndex]!.name}</p>
      <p>최종 점수(지분 가치 + 개인 자금): <b class="big-num">${money(G.finalScore(state))}</b></p>
      <p>회사 가치 ${money(G.valuation(co, state.player.traits))} × 지분 ${(co.ownership * 100).toFixed(1)}% · MRR ${money(co.mrr)} · 사용자 ${co.users.toLocaleString()}</p>
      <p>패권 진영: <b>${FACTIONS[top].name}</b>${top === co.faction && !bankrupt ? ' — 내 진영이 이겼어요. 칭호 획득!' : ''}</p>` : ''}
      <p class="hint">실제 서비스에서는 시즌이 끝나면 회사는 초기화되고 아바타의 능력치·경력·칭호만 남아요.</p>
      <div class="actions"><button class="primary" data-act="reset">새 시즌 시작</button></div>
    </section>
    ${renderLog()}
  </main>`;
}

// ---------------- 이벤트 ----------------

function topOther(stat: Stat): Stat {
  const st = state.player.stats;
  return [...STATS].filter((s) => s !== stat).sort((a, b) => st[b] - st[a])[0]!;
}
function lowOther(stat: Stat): Stat {
  const st = state.player.stats;
  return [...STATS].filter((s) => s !== stat).sort((a, b) => st[a] - st[b])[0]!;
}

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const act = el.dataset.act!;
  const arg = el.dataset.arg ?? '';
  switch (act) {
    case 'reset':
      if (state.phase === 'ended' || window.confirm('지금 게임을 지우고 새로 시작할까요?')) {
        foundName = '';
        tab = 'home';
        set(G.newGame(randomSeed()), '새 게임을 시작했어요');
      }
      return;
    case 'preset': return set(G.applyProfilePreset(readAvatarInputs(), arg), `${PROFILE_PRESETS[arg]!.label} 모양으로 능력치를 배분했어요`);
    case 'stat-up': return set(G.moveStatPoint(readAvatarInputs(), topOther(arg as Stat), arg as Stat));
    case 'stat-down': return set(G.moveStatPoint(readAvatarInputs(), arg as Stat, lowOther(arg as Stat)));
    case 'finish-avatar': return set(G.finishAvatar(readAvatarInputs()));
    case 'back-create': { const s = structuredClone(state); s.phase = 'create'; return set(s); }
    case 'suggest-name': nameSuggestion++; foundName = G.suggestCompanyName(state, nameSuggestion); return render();
    case 'pick-faction': foundName = (document.getElementById('company-name') as HTMLInputElement)?.value ?? foundName; foundFaction = arg as FactionId; return render();
    case 'found': {
      const name = (document.getElementById('company-name') as HTMLInputElement)?.value ?? foundName;
      tab = 'home';
      return set(G.foundCompany(state, name, foundFaction), '창업했어요. 먼저 채용 탭을 열어 보세요.');
    }
    case 'tab': tab = arg as Tab; return render();
    case 'answer': return set(G.answerMission(state, Number(arg)));
    case 'advance': {
      const prev = state.month;
      const next = G.advanceMonth(state);
      tab = next.phase === 'ended' ? tab : 'home';
      window.scrollTo({ top: 0 });
      return set(next, next.phase === 'ended' ? undefined : `${prev + 1}개월차 정산 완료`);
    }
    case 'intensity': return set(G.setIntensity(state, arg as 'normal' | 'crunch'));
    case 'fire': if (window.confirm('정말 내보낼까요? 퇴직금으로 한 달치 월급이 나가요.')) set(G.fire(state, arg)); return;
    case 'probe': { const [id, stat] = arg.split('|'); return set(G.liveProbe(state, id!, stat as Stat)); }
    case 'delegate': return set(G.delegateInterview(state, arg), '위임 면접 결과가 나왔어요');
    case 'offer': {
      const salary = Number((document.getElementById(`offer-${arg}`) as HTMLInputElement).value);
      const sel = document.querySelector<HTMLSelectElement>(`select[data-arg="offer-${arg}"]`);
      const r = G.offer(state, arg, salary, (sel?.value ?? 'dev') as TaskId);
      return set(r.state, r.message);
    }
    case 'trait': return set(G.chooseTrait(state, arg));
    case 'accept-offer': return set(G.acceptOffer(state, Number(arg)), '투자를 유치했어요');
    case 'decline-offer': return set(G.declineOffer(state, Number(arg)));
    case 'buy': { const r = G.buyItem(state, arg); return set(r.state, r.message); }
    case 'equip': { const r = G.equipItem(state, arg); return set(r.state, r.message); }
    case 'unequip': return set(G.unequipItem(state, arg));
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  const kind = el.dataset.input;
  const arg = el.dataset.arg ?? '';
  if (kind === 'task' && !arg.startsWith('offer-')) return set(G.assignTask(state, arg, el.value as TaskId));
  if (kind === 'salary') {
    const before = state.company?.employees.find((e) => e.id === arg)?.salary ?? 0;
    const next = G.setSalary(state, arg, Number(el.value));
    const after = next.company?.employees.find((e) => e.id === arg)?.salary ?? 0;
    return set(next, after > Number(el.value) ? `월급 하한 ${money(after)}까지만 내릴 수 있어요` : after < before ? '월급을 깎아 만족도가 떨어졌어요' : undefined);
  }
  if (kind === 'ad-budget') return set(G.setAdBudget(state, Number(el.value)));
  if (kind === 'schedule') return set(G.setSchedule(state, Number(arg) as 0 | 1 | 2, parseActivity(el.value)));
  if (kind === 'spend-limit') return set(G.setSpendLimit(state, Number(el.value)));
  if (state.phase === 'create' && (el.id === 'heu' || el.classList.contains('ex') || el.id === 'avatar-name')) set(readAvatarInputs());
});

function readAvatarInputs(): GameState {
  if (state.phase !== 'create') return state;
  let s = state;
  const name = document.getElementById('avatar-name') as HTMLInputElement | null;
  if (name) s = G.setAvatarName(s, name.value);
  const heu = document.getElementById('heu') as HTMLInputElement | null;
  if (heu) s = G.setHeuBalance(s, Number(heu.value));
  const weeks = Array.from(document.querySelectorAll<HTMLInputElement>('input.ex'));
  if (weeks.length) {
    const days = [0, 0, 0, 0];
    for (const w of weeks) days[3 - Number(w.dataset.week)] = Number(w.value);
    s = G.setExercise(s, days);
  }
  return s;
}

render();
