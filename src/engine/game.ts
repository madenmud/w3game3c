// 게임 상태 전이. 모든 함수는 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import {
  COMPANY_NAME_PARTS, EVENTS, FACTIONS, INVESTORS, ITEMS, MISSIONS, NAME_PARTS, PROFILE_PRESETS,
  ROUNDS, SEASON_MONTHS, STAT_LABEL, STAT_MAX, STAT_MIN, STAT_TOTAL, TASKS, TRAIT_TREE,
} from './data';
import { clamp, intBetween, pick, rngFor, uniform, type Rng } from './rng';
import {
  canEquip, effectiveStats, fatigueEfficiency, fit, fitnessTier, growthDelta, satisfactionMod, wearPoints,
} from './rules';
import {
  STATS, type Activity, type Avatar, type Candidate, type Company, type Employee,
  type FactionId, type GameState, type Intensity, type MonthReport, type Range, type Rival, type Stat,
  type Stats, type TaskId,
} from './types';

export const START_CASH = 50_000;
export const OFFICE_COST = 1_000;
export const MAX_EMPLOYEES = 8;
export const ARPU = 2;
export const MONTHLY_SPEND_LIMIT_DEFAULT = 50;

const clone = <T>(x: T): T => structuredClone(x);

function randomName(rng: Rng): string {
  return pick(rng, NAME_PARTS.FAMILY) + pick(rng, NAME_PARTS.GIVEN);
}

function companyName(rng: Rng): string {
  return pick(rng, COMPANY_NAME_PARTS.a) + ' ' + pick(rng, COMPANY_NAME_PARTS.b);
}

export function statTotal(s: Stats): number {
  return STATS.reduce((a, k) => a + s[k], 0);
}

/** 가중치 모양대로 총합 total을 나눈다(각 능력치는 STAT_MIN~STAT_MAX). */
export function distribute(weights: Record<Stat, number>, total: number, rng?: Rng): Stats {
  const w = STATS.map((s) => weights[s] * (rng ? uniform(rng, 0.9, 1.1) : 1));
  const sumW = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / sumW) * total);
  const out = {} as Stats;
  STATS.forEach((s, i) => { out[s] = clamp(Math.round(raw[i] as number), STAT_MIN, STAT_MAX); });
  // 반올림 오차를 맞춘다
  let diff = total - statTotal(out);
  const order = [...STATS].sort((a, b) => weights[b] - weights[a]);
  let guard = 0;
  while (diff !== 0 && guard++ < 1000) {
    for (const s of diff > 0 ? order : [...order].reverse()) {
      if (diff === 0) break;
      const next = out[s] + Math.sign(diff);
      if (next >= STAT_MIN && next <= STAT_MAX) { out[s] = next; diff -= Math.sign(diff); }
    }
  }
  return out;
}

export function newGame(seed: string): GameState {
  const rng = rngFor(seed, 'avatar');
  const player: Avatar = {
    name: randomName(rng),
    stats: distribute(PROFILE_PRESETS.balanced!.weights, STAT_TOTAL),
    fatigue: 20,
    careerMonths: 0,
    personalCash: 0,
    heuBalance: 0,
    exerciseDaysPerWeek: [0, 0, 0, 0],
    linkedProfile: null,
    schedule: [{ kind: 'study', stat: 'dev' }, { kind: 'study', stat: 'dev' }, { kind: 'rest' }],
    forcedRest: false,
    traits: [],
    pendingTraitChoice: null,
    inventory: [],
    equipped: [],
    spentThisMonthUsd: 0,
    monthlySpendLimitUsd: MONTHLY_SPEND_LIMIT_DEFAULT,
  };
  return {
    version: 1,
    seed,
    month: 0,
    phase: 'create',
    endReason: null,
    player,
    company: null,
    candidates: [],
    rivals: makeRivals(seed),
    offers: [],
    mission: null,
    reviewQueue: [],
    monthsSeenCards: [],
    lastEvent: null,
    log: [],
    lastReport: null,
  };
}

// ---------- 아바타 ----------

/** 프로필 연동(목업): 능력치 '모양'만 정하고 총합은 그대로다. */
export function applyProfilePreset(state: GameState, presetId: string): GameState {
  const p = PROFILE_PRESETS[presetId];
  if (!p || state.phase !== 'create') return state;
  const s = clone(state);
  s.player.stats = distribute(p.weights, STAT_TOTAL, rngFor(s.seed, 'preset', presetId));
  s.player.linkedProfile = presetId;
  return s;
}

/** 능력치 1점을 from에서 to로 옮긴다(총합 유지). */
export function moveStatPoint(state: GameState, from: Stat, to: Stat, amount = 1): GameState {
  if (state.phase !== 'create' || from === to) return state;
  const st = state.player.stats;
  const n = Math.min(amount, st[from] - STAT_MIN, STAT_MAX - st[to]);
  if (n <= 0) return state;
  const s = clone(state);
  s.player.stats[from] -= n;
  s.player.stats[to] += n;
  return s;
}

export function setAvatarName(state: GameState, name: string): GameState {
  const s = clone(state);
  s.player.name = name.trim().slice(0, 12) || s.player.name;
  return s;
}

export function setHeuBalance(state: GameState, balance: number): GameState {
  const s = clone(state);
  s.player.heuBalance = Math.max(0, Math.floor(balance || 0));
  return s;
}

export function setExercise(state: GameState, days: number[]): GameState {
  const s = clone(state);
  s.player.exerciseDaysPerWeek = days.slice(0, 4).map((d) => clamp(Math.floor(d || 0), 0, 7));
  return s;
}

export function finishAvatar(state: GameState): GameState {
  if (state.phase !== 'create') return state;
  const s = clone(state);
  s.phase = 'found';
  return s;
}

// ---------- 창업 ----------

export function suggestCompanyName(state: GameState, n: number): string {
  return companyName(rngFor(state.seed, 'company-name', n));
}

export function foundCompany(state: GameState, name: string, faction: FactionId): GameState {
  if (state.phase !== 'found') return state;
  const s = clone(state);
  s.company = {
    name: name.trim().slice(0, 20) || suggestCompanyName(state, 0),
    faction,
    cash: START_CASH,
    product: 5,
    users: 0,
    enterpriseMrr: 0,
    mrr: 0,
    brand: 5,
    culture: 50,
    retentionBonus: 0,
    aiScore: 0,
    irScore: 0,
    intensity: 'normal',
    playerTask: bestTaskFor(s.player.stats),
    employees: [],
    roundIndex: 0,
    ownership: 1,
    negativeCashMonths: 0,
    history: [],
  };
  s.phase = 'play';
  s.candidates = makeCandidates(s, 5);
  s.mission = drawMission(s);
  s.lastEvent = eventFor(s.seed, s.month);
  pushLog(s, `${s.company.name} 창업. ${FACTIONS[faction].name}와 제휴했다.`, 'info');
  return s;
}

export function bestTaskFor(stats: Stats): TaskId {
  let best: TaskId = 'dev';
  let bestFit = -1;
  for (const t of Object.values(TASKS)) {
    const f = fit(stats, t.main, t.sub);
    if (f > bestFit) { bestFit = f; best = t.id; }
  }
  return best;
}

// ---------- 채용 ----------

export function askingSalary(stats: Stats): number {
  return Math.round((800 + statTotal(stats) * 8) / 50) * 50;
}

function makeCandidate(rng: Rng, id: string): Candidate {
  const total = intBetween(rng, 170, 300);
  const peaks = [pick(rng, STATS), pick(rng, STATS)];
  const weights = {} as Record<Stat, number>;
  for (const st of STATS) weights[st] = 0.7 + (peaks.includes(st) ? 0.9 : 0) + rng() * 0.3;
  const stats = distribute(weights, total, rng);
  const estimate = {} as Record<Stat, Range>;
  for (const st of STATS) {
    const left = intBetween(rng, 0, 30);
    estimate[st] = { lo: clamp(stats[st] - left, 0, 100), hi: clamp(stats[st] + (30 - left), 0, 100) };
  }
  const ask = Math.round(askingSalary(stats) * uniform(rng, 0.9, 1.1) / 50) * 50;
  return { id, name: randomName(rng), stats, estimate, ask, interviewed: 'none', liveProbesLeft: 3 };
}

export function makeCandidates(state: GameState, n: number): Candidate[] {
  const rng = rngFor(state.seed, 'candidates', state.month);
  return Array.from({ length: n }, (_, i) => makeCandidate(rng, `c${state.month}-${i}`));
}

/** 실시간 면접(목업): 질문 카드 하나로 한 능력치의 추정 범위를 ±3으로 좁힌다. */
export function liveProbe(state: GameState, candidateId: string, stat: Stat): GameState {
  const s = clone(state);
  const c = s.candidates.find((x) => x.id === candidateId);
  if (!c || c.liveProbesLeft <= 0) return state;
  const rng = rngFor(s.seed, 'probe', candidateId, stat, c.liveProbesLeft);
  const left = intBetween(rng, 0, 6);
  c.estimate[stat] = { lo: clamp(c.stats[stat] - left, 0, 100), hi: clamp(c.stats[stat] + 6 - left, 0, 100) };
  c.liveProbesLeft -= 1;
  c.interviewed = 'live';
  return s;
}

/** 위임 면접: 채용 담당(없으면 오너)의 리더십으로 전체 오차를 정한다. */
export function delegatedInterviewError(state: GameState): number {
  const hr = state.company?.employees.filter((e) => e.task === 'hiring').map((e) => e.stats.leadership) ?? [];
  const leader = hr.length ? Math.max(...hr) : effectiveStats(state.player).leadership * 0.8;
  let err = Math.max(5, Math.round(25 - leader / 5));
  if (state.player.traits.includes('scout')) err = Math.max(3, Math.round(err / 2));
  return err;
}

export function delegateInterview(state: GameState, candidateId: string): GameState {
  const s = clone(state);
  const c = s.candidates.find((x) => x.id === candidateId);
  if (!c || c.interviewed === 'delegated') return state;
  const err = delegatedInterviewError(state);
  const rng = rngFor(s.seed, 'delegate', candidateId);
  for (const st of STATS) {
    const cur = c.estimate[st];
    if (cur.hi - cur.lo <= 2 * err) continue;
    const left = intBetween(rng, 0, 2 * err);
    c.estimate[st] = { lo: clamp(c.stats[st] - left, 0, 100), hi: clamp(c.stats[st] + 2 * err - left, 0, 100) };
  }
  c.interviewed = 'delegated';
  return s;
}

export function acceptanceThreshold(state: GameState, c: Candidate): number {
  const co = state.company;
  let t = c.ask;
  if (co?.faction === 'west') t *= 0.9;
  if (co) t *= 1 - co.brand / 500;
  return Math.round(t);
}

export function offer(state: GameState, candidateId: string, salary: number, task: TaskId): { state: GameState; accepted: boolean; message: string } {
  const co = state.company;
  const c = state.candidates.find((x) => x.id === candidateId);
  if (!co || !c) return { state, accepted: false, message: '대상이 없어요' };
  if (co.employees.length >= MAX_EMPLOYEES) return { state, accepted: false, message: `직원은 최대 ${MAX_EMPLOYEES}명이에요` };
  const need = acceptanceThreshold(state, c);
  const s = clone(state);
  if (salary < need) {
    s.candidates = s.candidates.filter((x) => x.id !== candidateId);
    pushLog(s, `${c.name} 님이 제안(${fmtMoney(salary)})을 거절하고 떠났다.`, 'bad');
    return { state: s, accepted: false, message: `${c.name} 님이 거절했어요. 기대보다 낮은 제안이었어요.` };
  }
  const e: Employee = { id: c.id, name: c.name, stats: c.stats, salary, satisfaction: clamp(60 + ((salary / c.ask) - 1) * 100, 40, 90), task, hiredMonth: s.month };
  s.company!.employees.push(e);
  s.candidates = s.candidates.filter((x) => x.id !== candidateId);
  pushLog(s, `${c.name} 님 입사. 월급 ${fmtMoney(salary)}, ${TASKS[task].label} 담당.`, 'good');
  return { state: s, accepted: true, message: `${c.name} 님이 합류했어요.` };
}

export function assignTask(state: GameState, who: 'player' | string, task: TaskId): GameState {
  const s = clone(state);
  if (!s.company) return state;
  if (who === 'player') s.company.playerTask = task;
  else { const e = s.company.employees.find((x) => x.id === who); if (e) e.task = task; }
  return s;
}

export function setSalary(state: GameState, employeeId: string, salary: number): GameState {
  const s = clone(state);
  const e = s.company?.employees.find((x) => x.id === employeeId);
  if (!e) return state;
  e.salary = Math.max(0, Math.round(salary / 50) * 50);
  return s;
}

export function fire(state: GameState, employeeId: string): GameState {
  const s = clone(state);
  if (!s.company) return state;
  const e = s.company.employees.find((x) => x.id === employeeId);
  if (!e) return state;
  s.company.employees = s.company.employees.filter((x) => x.id !== employeeId);
  s.company.cash -= e.salary; // 퇴직금 한 달치
  s.company.culture = clamp(s.company.culture - 5, 0, 100);
  pushLog(s, `${e.name} 님을 내보냈다. 퇴직금 ${fmtMoney(e.salary)}.`, 'bad');
  return s;
}

export function setIntensity(state: GameState, intensity: Intensity): GameState {
  const s = clone(state);
  if (s.company) s.company.intensity = intensity;
  return s;
}

// ---------- 개인 성장 ----------

export function setSchedule(state: GameState, slot: 0 | 1 | 2, act: Activity): GameState {
  const s = clone(state);
  s.player.schedule[slot] = act;
  return s;
}

export function chooseTrait(state: GameState, traitId: string): GameState {
  const pend = state.player.pendingTraitChoice;
  if (!pend) return state;
  const node = TRAIT_TREE.find((t) => t.stat === pend.stat && t.threshold === pend.threshold);
  if (!node?.options.some((o) => o.id === traitId)) return state;
  const s = clone(state);
  s.player.traits.push(traitId);
  s.player.pendingTraitChoice = null;
  const o = node.options.find((x) => x.id === traitId)!;
  pushLog(s, `특성 '${o.name}'을(를) 얻었다. ${o.desc}`, 'good');
  return s;
}

// ---------- 미션(학습 카드) ----------

export function drawMission(state: GameState): GameState['mission'] {
  const due = state.reviewQueue.find((r) => r.dueMonth <= state.month);
  if (due) return { cardId: due.cardId, answered: false, correct: false };
  const studied = state.player.schedule.filter((a) => a.kind === 'study').map((a) => (a as { stat: Stat }).stat);
  const taskStat = state.company ? TASKS[state.company.playerTask].main : 'dev';
  const wanted = new Set<Stat>([taskStat, ...studied]);
  const rng = rngFor(state.seed, 'mission', state.month);
  const fresh = MISSIONS.filter((m) => wanted.has(m.stat) && !state.monthsSeenCards.includes(m.id));
  const pool = fresh.length ? fresh : MISSIONS.filter((m) => !state.monthsSeenCards.includes(m.id));
  const card = pick(rng, pool.length ? pool : MISSIONS);
  return { cardId: card.id, answered: false, correct: false };
}

export function answerMission(state: GameState, choice: number): GameState {
  if (!state.mission || state.mission.answered) return state;
  const card = MISSIONS.find((m) => m.id === state.mission!.cardId)!;
  const s = clone(state);
  const correct = card.answer === choice;
  s.mission = { cardId: card.id, answered: true, correct };
  s.reviewQueue = s.reviewQueue.filter((r) => r.cardId !== card.id);
  if (!s.monthsSeenCards.includes(card.id)) s.monthsSeenCards.push(card.id);
  if (!correct) s.reviewQueue.push({ cardId: card.id, dueMonth: s.month + 2 });
  return s;
}

// ---------- 상점(코인 결제 목업) ----------

export function buyItem(state: GameState, itemId: string): { state: GameState; message: string } {
  const it = ITEMS.find((i) => i.id === itemId);
  if (!it) return { state, message: '없는 아이템이에요' };
  if (state.player.inventory.includes(itemId)) return { state, message: '이미 가지고 있어요' };
  if (state.player.spentThisMonthUsd + it.priceUsd > state.player.monthlySpendLimitUsd) {
    return { state, message: `이번 달 결제 한도(${state.player.monthlySpendLimitUsd}달러)를 넘어요` };
  }
  const s = clone(state);
  s.player.inventory.push(itemId);
  s.player.spentThisMonthUsd += it.priceUsd;
  pushLog(s, `테스트 결제 ${it.priceUsd} USDC로 '${it.name}'을(를) 샀다.`, 'info');
  return { state: s, message: `'${it.name}' 구매 완료(테스트 결제)` };
}

export function equipItem(state: GameState, itemId: string): { state: GameState; message: string } {
  if (!state.player.inventory.includes(itemId)) return { state, message: '가지고 있지 않아요' };
  const chk = canEquip(state.player, itemId);
  if (!chk.ok) return { state, message: chk.reason ?? '착용할 수 없어요' };
  const s = clone(state);
  s.player.equipped.push(itemId);
  return { state: s, message: '착용했어요' };
}

export function unequipItem(state: GameState, itemId: string): GameState {
  const s = clone(state);
  s.player.equipped = s.player.equipped.filter((x) => x !== itemId);
  return s;
}

export function setSpendLimit(state: GameState, usd: number): GameState {
  const s = clone(state);
  s.player.monthlySpendLimitUsd = clamp(Math.round(usd), 0, 500);
  return s;
}

// ---------- 투자 ----------

export function valuation(co: Company, traits: string[] = []): number {
  const aiMult = Math.min(4, co.aiScore / 200) * (traits.includes('evangelist') ? 1.5 : 1);
  const mult = 6 + aiMult;
  return Math.round(200_000 + co.product * 3_000 + co.users * 5 + co.mrr * 12 * mult);
}

function maybeCreateOffer(s: GameState, rng: Rng) {
  const co = s.company!;
  const next = co.roundIndex + 1;
  if (next >= ROUNDS.length) return;
  if (s.offers.some((o) => o.round === next)) return;
  const r = ROUNDS[next]!;
  if (co.mrr < r.minMrr || co.product < r.minProduct) return;
  let pre = valuation(co, s.player.traits) * clamp(0.85 + co.irScore / 400, 0.85, 1.3);
  if (co.faction === 'north') pre *= 1.15;
  if (s.player.traits.includes('storyteller')) pre *= 1.1;
  let amount = (pre * r.dilution) / (1 - r.dilution);
  if (s.player.traits.includes('dealmaker')) amount *= 1.1;
  s.offers.push({ round: next, investor: pick(rng, INVESTORS), amount: Math.round(amount / 1000) * 1000, preMoney: Math.round(pre / 1000) * 1000, expiresMonth: s.month + 3 });
  pushLog(s, `${r.name} 투자 제안이 도착했다.`, 'good');
}

export function acceptOffer(state: GameState, round: number): GameState {
  const o = state.offers.find((x) => x.round === round);
  if (!o || !state.company) return state;
  const s = clone(state);
  const co = s.company!;
  const stake = o.amount / (o.preMoney + o.amount);
  co.cash += o.amount;
  co.ownership *= 1 - stake;
  co.roundIndex = round;
  s.offers = s.offers.filter((x) => x.round !== round);
  pushLog(s, `${ROUNDS[round]!.name} 유치: ${o.investor}에서 ${fmtMoney(o.amount)} (지분 ${(stake * 100).toFixed(1)}%).`, 'good');
  return s;
}

export function declineOffer(state: GameState, round: number): GameState {
  const s = clone(state);
  s.offers = s.offers.filter((x) => x.round !== round);
  return s;
}

// ---------- 경쟁사·진영 ----------

function makeRivals(seed: string): Rival[] {
  const rng = rngFor(seed, 'rivals');
  const out: Rival[] = [];
  (['north', 'west', 'south'] as FactionId[]).forEach((f) => {
    for (let i = 0; i < 3; i++) {
      out.push({ id: `${f}-${i}`, name: companyName(rng), faction: f, valuation: Math.round(uniform(rng, 250_000, 600_000)), momentum: uniform(rng, 0.02, 0.06) });
    }
  });
  return out;
}

export function factionScores(state: GameState): Record<FactionId, number> {
  const sc: Record<FactionId, number> = { north: 0, west: 0, south: 0 };
  for (const r of state.rivals) sc[r.faction] += r.valuation;
  if (state.company) sc[state.company.faction] += valuation(state.company, state.player.traits);
  return sc;
}

export function eventFor(seed: string, month: number): GameState['lastEvent'] {
  const e = pick(rngFor(seed, 'event', month), EVENTS);
  return { id: e.id, title: e.title, text: e.text };
}

// ---------- 월 정산 ----------

function eventMult(eventId: string | undefined, faction: FactionId, task: TaskId): number {
  const e = EVENTS.find((x) => x.id === eventId) ;
  if (!e || !e.task || e.task !== task) return 1;
  if (e.faction && e.faction !== faction) return 1;
  return e.mult;
}

export function playerOutputMod(fatigue: number): number {
  return clamp(1.1 - fatigue / 250, 0.7, 1.1);
}

export function advanceMonth(state: GameState): GameState {
  if (state.phase !== 'play' || !state.company) return state;
  const s = clone(state);
  const co = s.company!;
  const p = s.player;
  const rng = rngFor(s.seed, 'settle', s.month);
  const ev = eventFor(s.seed, s.month);
  const report: MonthReport = {
    month: s.month, outputs: [], revenue: 0, costs: 0, cashDelta: 0, usersDelta: 0, resigned: [], growth: [], fatigueAfter: 0, event: ev ? `${ev.title}: ${ev.text}` : null,
  };
  const crunch = co.intensity === 'crunch' ? 1.2 : 1;
  const tierFit = fitnessTier(p.exerciseDaysPerWeek);

  // 1) 업무 성과
  type Worker = { who: string; stats: Stats; task: TaskId; mod: number; missionBonus: number };
  const workers: Worker[] = [];
  const missionOk = !!s.mission?.answered && s.mission.correct;
  let playerMission = missionOk ? 0.2 : 0;
  if (missionOk && p.traits.includes('hacker') && co.playerTask === 'dev') playerMission += 0.2;
  workers.push({ who: p.name, stats: effectiveStats(p), task: co.playerTask, mod: playerOutputMod(p.fatigue), missionBonus: playerMission });
  for (const e of co.employees) workers.push({ who: e.name, stats: e.stats, task: e.task, mod: satisfactionMod(e.satisfaction), missionBonus: 0 });

  const sum: Record<TaskId, number> = { dev: 0, ai: 0, plan: 0, sales: 0, marketing: 0, hiring: 0, finance: 0 };
  for (const w of workers) {
    const t = TASKS[w.task];
    let out = 10 * fit(w.stats, t.main, t.sub) * w.mod * (1 + w.missionBonus) * uniform(rng, 0.85, 1.15);
    out *= crunch * (1 + (FACTIONS[co.faction].taskBonus[w.task] ?? 0)) * eventMult(ev?.id, co.faction, w.task);
    if (w.who === p.name) {
      if (w.task === 'sales' && p.traits.includes('closer')) out *= 1.15;
      if (w.task === 'ai' && p.traits.includes('researcher')) out *= 1.1;
    }
    if (w.task === 'dev' && p.traits.includes('architect')) out *= 1.05;
    out = Math.round(out * 10) / 10;
    sum[w.task] += out;
    report.outputs.push({ who: w.who, task: w.task, output: out });
  }

  // 2) 지표 반영
  co.product = clamp(co.product + sum.dev * 0.35 * (1 - co.product / 110) + sum.ai * 0.15 * (1 - co.product / 110), 0, 100);
  co.aiScore += sum.ai;
  co.retentionBonus = Math.min(0.05, co.retentionBonus + sum.plan * 0.0008 * (p.traits.includes('designer') ? 1.2 : 1));
  const churn = 0.08 - co.retentionBonus;
  const newUsers = sum.marketing * 25 * (0.4 + co.product / 100) * (1 + co.brand / 100) + co.product * 6;
  const beforeUsers = co.users;
  co.users = Math.round(co.users * (1 - churn) + newUsers);
  report.usersDelta = co.users - beforeUsers;
  co.brand = clamp(co.brand + sum.marketing * 0.2 * (1 - co.brand / 100), 0, 100);
  co.enterpriseMrr = co.enterpriseMrr * 0.98 + sum.sales * 25 * (co.product / 100);
  co.culture = clamp(co.culture + sum.hiring * 0.4 * (1 - co.culture / 100) - (co.intensity === 'crunch' ? 2 : 0) - 0.5, 0, 100);
  co.irScore = Math.min(200, co.irScore + sum.finance * 0.6);
  co.mrr = Math.round(co.users * ARPU * (co.product / 100) + co.enterpriseMrr);

  // 3) 현금 흐름
  const salaries = co.employees.reduce((a, e) => a + e.salary, 0);
  let costs = salaries + OFFICE_COST + 200 * co.employees.length;
  if (p.traits.includes('cfo')) costs *= 0.9;
  const savings = Math.min(costs * 0.3, sum.finance * 60);
  costs = Math.round(costs - savings);
  report.revenue = co.mrr;
  report.costs = costs;
  report.cashDelta = co.mrr - costs;
  co.cash = Math.round(co.cash + report.cashDelta);
  co.negativeCashMonths = co.cash < 0 ? co.negativeCashMonths + 1 : 0;

  // 4) 직원 만족도와 퇴사
  const keep: Employee[] = [];
  for (const e of co.employees) {
    const market = askingSalary(e.stats);
    const top2 = [...STATS].sort((a, b) => e.stats[b] - e.stats[a]).slice(0, 2);
    let d = clamp(((e.salary / market) - 1) * 30, -5, 5);
    d += top2.includes(TASKS[e.task].main) ? 2 : -2;
    d += (co.culture - 50) / 25;
    d += co.intensity === 'crunch' ? -3 : 1;
    if (p.traits.includes('captain')) d += 1;
    if (co.faction === 'west' && d < 0) d *= 0.7;
    d += uniform(rng, -1, 1);
    e.satisfaction = clamp(e.satisfaction + d, 0, 100);
    if (e.satisfaction < 30 && rng() < 0.3) {
      report.resigned.push(e.name);
      pushLog(s, `${e.name} 님이 퇴사했다(만족도 ${Math.round(e.satisfaction)}).`, 'bad');
    } else keep.push(e);
  }
  co.employees = keep;

  // 5) 개인 스케줄: 성장·피로
  const schedule: Activity[] = [...p.schedule];
  if (p.forcedRest) schedule[0] = { kind: 'rest' };
  const fatigueBefore = p.fatigue;
  let fatigue = p.fatigue + 10 + (co.intensity === 'crunch' ? 10 : 0) - 10 - tierFit * 2 - (p.traits.includes('pm') ? 3 : 0);
  let networked = false;
  const eff = fatigueEfficiency(fatigueBefore) * (1 + (missionOk ? 0.2 : 0) + 0.1 * (tierFit / 3));
  for (const a of schedule) {
    if (a.kind === 'study') {
      const before = p.stats[a.stat];
      const d = growthDelta(before, eff);
      p.stats[a.stat] = Math.min(STAT_MAX, before + d);
      report.growth.push({ stat: a.stat, delta: d });
      fatigue += 15;
    } else if (a.kind === 'rest') fatigue -= 30;
    else if (a.kind === 'side') { fatigue += 10; p.personalCash += 400; }
    else if (a.kind === 'network') { fatigue += 5; networked = true; }
  }
  p.fatigue = clamp(fatigue, 0, 100);
  p.forcedRest = p.fatigue >= 80;
  if (p.forcedRest) pushLog(s, '피로가 80을 넘었다. 다음 달 첫 칸은 강제 휴식이다.', 'bad');
  report.fatigueAfter = p.fatigue;
  p.careerMonths += 1;
  p.spentThisMonthUsd = 0;
  for (const node of TRAIT_TREE) {
    if (!p.pendingTraitChoice && p.stats[node.stat] >= node.threshold && p.traits.length < 3 && !node.options.some((o) => p.traits.includes(o.id))) {
      p.pendingTraitChoice = { stat: node.stat, threshold: node.threshold };
      pushLog(s, `${STAT_LABEL[node.stat]} ${node.threshold} 달성. 특성을 고를 수 있다.`, 'good');
    }
  }

  // 6) 경쟁사
  for (const r of s.rivals) {
    let g = r.momentum + uniform(rng, -0.03, 0.03);
    const e = EVENTS.find((x) => x.id === ev?.id);
    if (e?.faction === r.faction) g += e.mult > 1 ? 0.02 : -0.02;
    r.valuation = Math.max(50_000, Math.round(r.valuation * (1 + g)));
  }

  // 7) 다음 달 준비
  co.history.push({ month: s.month, mrr: co.mrr, cash: co.cash, valuation: valuation(co, p.traits), users: co.users });
  s.month += 1;
  s.offers = s.offers.filter((o) => o.expiresMonth >= s.month);
  maybeCreateOffer(s, rng);
  if (s.month % 3 === 0 || networked) {
    const fresh = makeCandidates(s, networked ? 2 : 5);
    s.candidates = (s.month % 3 === 0 ? fresh : [...s.candidates, ...fresh]).slice(-8);
  }
  s.mission = drawMission(s);
  s.lastEvent = eventFor(s.seed, s.month);
  s.lastReport = report;
  pushLog(s, `${s.month}개월차 정산: 매출 ${fmtMoney(report.revenue)}, 비용 ${fmtMoney(report.costs)}, 현금 ${fmtMoney(co.cash)}.`, report.cashDelta >= 0 ? 'good' : 'info');

  if (co.negativeCashMonths >= 2) {
    s.phase = 'ended';
    s.endReason = 'bankrupt';
    pushLog(s, '현금이 두 달 연속 바닥이었다. 회사가 문을 닫았다.', 'bad');
  } else if (s.month >= SEASON_MONTHS) {
    s.phase = 'ended';
    s.endReason = 'season';
    pushLog(s, '시즌이 끝났다.', 'info');
  }
  return s;
}

/** 지금 비용과 매출이 그대로일 때 현금이 버티는 개월 수 */
export function runwayMonths(co: Company): number {
  const costs = co.employees.reduce((a, e) => a + e.salary, 0) + OFFICE_COST + 200 * co.employees.length;
  const burn = costs - co.mrr;
  if (burn <= 0) return Infinity;
  return Math.max(0, co.cash / burn);
}

export function finalScore(state: GameState): number {
  const co = state.company;
  if (!co) return 0;
  if (state.endReason === 'bankrupt') return state.player.personalCash;
  return Math.round(valuation(co, state.player.traits) * co.ownership + state.player.personalCash);
}

export function wearInfo(av: Avatar) {
  const used = av.equipped.reduce((s, id) => s + (ITEMS.find((i) => i.id === id)?.bonus ?? 0), 0);
  return { used, limit: wearPoints(av.careerMonths) };
}

// ---------- 기타 ----------

export function pushLog(s: GameState, text: string, tone: 'good' | 'bad' | 'info' = 'info') {
  s.log.push({ month: s.month, text, tone });
  if (s.log.length > 200) s.log = s.log.slice(-200);
}

export function fmtMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1000).toFixed(1)}k`;
  return `${sign}$${a.toLocaleString('en-US')}`;
}
