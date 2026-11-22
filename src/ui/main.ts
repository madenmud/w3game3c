import '../style.css';
import { FACTIONS, FACTION_IDS, INTERVIEW_QA, ITEMS, PROFILE_PRESETS, ROUNDS, SEASON_MONTHS, STAT_LABEL, STAT_TOTAL, TRAIT_TREE } from '../engine/data';
import * as G from '../engine/game';
import { fitnessTier, heuBonus } from '../engine/rules';
import { STATS, type Activity, type FactionId, type GameState, type Stat, type TaskId } from '../engine/types';
import { bar, esc, money, r0, runwayText, traitChoice } from './kit';
import { answerFor, draftFor, renderHire } from './screens/hire';
import { renderHome } from './screens/home';
import { renderTeam } from './screens/team';
import { resetUi, ui } from './store';

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
  const content = { home: () => renderHome(state), team: () => renderTeam(state), hire: () => renderHire(state), growth: renderGrowth, invest: renderInvest, shop: renderShop, faction: renderFaction, log: renderLog }[tab]();
  const ev = state.lastEvent;
  return `
  <div class="status">
    <div><span class="k">${esc(co.name)}</span><span class="v">${state.month + 1}개월차 / ${SEASON_MONTHS}</span></div>
    <div><span class="k">현금 · 런웨이 ${runwayText(G.runwayMonths(co))}</span><span class="v ${co.cash < 0 ? 'neg' : ''}">${money(co.cash)}</span></div>
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

function activitySelect(slot: number, a: Activity): string {
  const opts: [string, string][] = [
    ...STATS.map((s) => [`study:${s}`, `수업: ${STAT_LABEL[s]}`] as [string, string]),
    ['rest', '휴식·운동 (피로 -30)'], ['side', '부업 (개인 자금 +$400)'], ['network', '네트워킹 (후보 +2)'],
  ];
  return `<select data-input="schedule" data-arg="${slot}">${opts.map(([v, l]) => `<option value="${v}" ${v === activityValue(a) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

function renderGrowth(): string {
  const p = state.player;
  const tier = fitnessTier(p.exerciseDaysPerWeek);
  const traitNames = p.traits.map((id) => TRAIT_TREE.flatMap((t) => t.options).find((o) => o.id === id)?.name ?? id);
  return `
  ${traitChoice(state)}
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
        resetUi();
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
    case 'tab': tab = arg as Tab; window.scrollTo({ top: 0 }); return render();
    case 'goto': document.getElementById(arg)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    case 'select': ui.selected = ui.selected === arg || !arg ? null : arg; return render();
    case 'assign': {
      if (!ui.selected) return;
      const who = ui.selected;
      ui.selected = null;
      return set(G.assignTask(state, who, arg as TaskId));
    }
    case 'open-cand': ui.candidateId = arg || null; window.scrollTo({ top: 0 }); return render();
    case 'answer': return set(G.answerMission(state, Number(arg)));
    case 'advance': {
      const prev = state.month;
      const next = G.advanceMonth(state);
      tab = next.phase === 'ended' ? tab : 'home';
      ui.selected = null;
      ui.candidateId = null;
      window.scrollTo({ top: 0 });
      return set(next, next.phase === 'ended' ? undefined : `${prev + 1}개월차 정산 완료`);
    }
    case 'intensity': return set(G.setIntensity(state, arg as 'normal' | 'crunch'));
    case 'fire': if (window.confirm('정말 내보낼까요? 퇴직금으로 한 달치 월급이 나가요.')) { ui.selected = null; set(G.fire(state, arg)); } return;
    case 'probe': {
      const [id, st] = arg.split('|') as [string, Stat];
      const next = G.liveProbe(state, id, st);
      const est = next.candidates.find((c) => c.id === id)?.estimate[st];
      if (next !== state && est) (ui.transcript[id] ??= []).push({ stat: st, q: INTERVIEW_QA[st].q, a: answerFor(st, est.lo, est.hi), lo: est.lo, hi: est.hi });
      return set(next);
    }
    case 'delegate': return set(G.delegateInterview(state, arg), '위임 면접 결과가 나왔어요');
    case 'offer': {
      const c = state.candidates.find((x) => x.id === arg);
      if (!c) return;
      const d = draftFor(c);
      const r = G.offer(state, arg, d.salary, d.task);
      if (r.state !== state) { ui.candidateId = null; delete ui.offerDraft[arg]; delete ui.transcript[arg]; }
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
  if (kind === 'offer-salary' || kind === 'offer-task') {
    const c = state.candidates.find((x) => x.id === arg);
    if (!c) return;
    const d = draftFor(c);
    if (kind === 'offer-salary') d.salary = Math.max(0, Math.round((Number(el.value) || 0) / 50) * 50);
    else d.task = el.value as TaskId;
    return render();
  }
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
