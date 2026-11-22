// 게임 상태 전이. 모든 함수는 입력 상태를 바꾸지 않고 새 상태를 돌려준다.
import {
  COMPANY_NAME_PARTS, EVENTS, FACTIONS, INVESTORS, ITEMS, MISSIONS, NAME_PARTS, PROFILE_PRESETS,
  ROUNDS, SEASON_MONTHS, STAT_LABEL, STAT_MAX, STAT_MIN, STAT_TOTAL, TASKS, TRAIT_TREE,
} from './data';
import { drawDilemma, resolveDilemma } from './dilemmas';
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
/** 월급 하한: 시장가의 70%. 이보다 낮게 깎을 수 없다. */
export const SALARY_FLOOR_RATIO = 0.7;
/** 광고: 기본 획득 단가와, 예산이 커질수록 단가가 오르는 기준 금액 */
export const AD_BASE_CAC = 15;
export const AD_SATURATION = 30_000;
export const AD_BUDGET_MAX = 50_000;
/** 크런치가 이 개월 수를 넘게 이어지면 성과 보너스가 줄고 만족도 하락이 커진다 */
export const CRUNCH_GRACE_MONTHS = 2;
/** 한 업무에 성과가 몰리면 체감한다: 10을 넘는 부분은 (합/10)^0.8 */
export const TASK_DIMINISH_EXP = 0.8;
/** AI 점수가 객단가를 올리는 상한(+50%) */
export const AI_ARPU_CAP = 0.5;
/** 오너가 학습 카드를 맞힌 달의 팀 전체 성과 가산 */
export const TEAM_MISSION_BONUS = 0.1;
/** 창업 직후 오너에게 기본으로 맡기는 업무 후보(매출이나 제품으로 바로 이어지는 업무) */
const STARTER_TASKS: TaskId[] = ['dev', 'plan', 'sales', 'marketing'];

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
    dilemma: null,
    dilemmaSeen: [],
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
    crunchMonths: 0,
    adBudget: 0,
    playerTask: bestTaskFor(s.player.stats, STARTER_TASKS),
    employees: [],
    roundIndex: 0,
    ownership: 1,
    negativeCashMonths: 0,
    history: [],
    buffs: [],
  };
  s.phase = 'play';
  s.candidates = makeCandidates(s, 5);
  s.mission = drawMission(s);
  s.lastEvent = eventFor(s.seed, s.month);
  pushLog(s, `${s.company.name} 창업. ${FACTIONS[faction].name}와 제휴했다.`, 'info');
  return s;
}

export function bestTaskFor(stats: Stats, among: TaskId[] = Object.keys(TASKS) as TaskId[]): TaskId {
  let best: TaskId = among[0] ?? 'dev';
  let bestFit = -1;
  for (const t of among.map((id) => TASKS[id])) {
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

export function salaryFloor(stats: Stats): number {
  return Math.ceil((askingSalary(stats) * SALARY_FLOOR_RATIO) / 50) * 50;
}

/** 월급 변경. 하한(시장가 70%) 아래로는 못 내리고, 깎으면 만족도가 그 자리에서 떨어진다(10% 삭감 → -6). */
export function setSalary(state: GameState, employeeId: string, salary: number): GameState {
  const s = clone(state);
  const e = s.company?.employees.find((x) => x.id === employeeId);
  if (!e) return state;
  const next = Math.max(salaryFloor(e.stats), Math.round((salary || 0) / 50) * 50);
  if (next < e.salary) e.satisfaction = clamp(e.satisfaction - ((e.salary - next) / e.salary) * 60, 0, 100);
  e.salary = next;
  return s;
}

export function setAdBudget(state: GameState, usd: number): GameState {
  const s = clone(state);
  if (!s.company) return state;
  s.company.adBudget = clamp(Math.round((usd || 0) / 100) * 100, 0, AD_BUDGET_MAX);
  return s;
}

/** 광고 예산으로 얻는 월 신규 사용자. 예산이 커질수록 단가가 올라 체감한다. */
export function adUsers(budget: number, product: number): number {
  if (budget <= 0) return 0;
  return (budget / (AD_BASE_CAC * (1 + budget / AD_SATURATION))) * (0.4 + product / 100);
}

/** 크런치 성과 배수: 처음 2개월은 1.2, 그 뒤로 매달 0.1씩 줄어 최저 0.8 */
export function crunchOutputMult(crunchMonths: number): number {
  if (crunchMonths <= 0) return 1;
  return Math.max(0.8, 1.2 - 0.1 * Math.max(0, crunchMonths - CRUNCH_GRACE_MONTHS));
}

/** 업무별 성과 합의 체감: 10까지는 그대로, 넘으면 10·(합/10)^0.8 */
export function diminish(sum: number): number {
  return sum <= 10 ? sum : 10 * Math.pow(sum / 10, TASK_DIMINISH_EXP);
}

export function arpu(co: Company): number {
  const buffMult = (co.buffs ?? []).reduce((a, b) => a * (b.arpuMult ?? 1), 1);
  return ARPU * (1 + Math.min(AI_ARPU_CAP, co.aiScore / 400)) * buffMult;
}

/** 결단 카드 효과 중 이 사람·업무에 걸리는 성과 배수 */
export function buffOutputMult(co: Company, workerId: string, task: TaskId): number {
  let m = 1;
  for (const b of co.buffs ?? []) {
    if (b.mult === undefined) continue;
    if (b.workerId !== undefined ? b.workerId === workerId : b.task === 'all' || b.task === task) m *= b.mult;
  }
  return m;
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

/** 회사 가치 = 사업 가치 + 보유 현금. 투자금이 가치에 남아야 희석이 손해만 되지 않는다. */
export function valuation(co: Company, traits: string[] = []): number {
  const aiMult = Math.min(2, co.aiScore / 300) * (traits.includes('evangelist') ? 1.5 : 1);
  const mult = 6 + aiMult;
  return Math.round(200_000 + co.product * 3_000 + co.users * 5 + co.mrr * 12 * mult + Math.max(0, co.cash));
}

/** 최근 3개월 MRR 성장률(0~0.6). VC 프리머니 웃돈에 쓴다. */
export function growthPremium(co: Company): number {
  const h = co.history;
  if (h.length < 4) return 0;
  const before = h[h.length - 4]!.mrr;
  const now = h[h.length - 1]!.mrr;
  if (before <= 0) return now > 0 ? 0.6 : 0;
  return clamp(now / before - 1, 0, 0.6);
}

function maybeCreateOffer(s: GameState, rng: Rng) {
  const co = s.company!;
  const next = co.roundIndex + 1;
  if (next >= ROUNDS.length) return;
  if (s.offers.some((o) => o.round === next)) return;
  const r = ROUNDS[next]!;
  if (co.mrr < r.minMrr || co.product < r.minProduct) return;
  // VC는 성장률에 웃돈을 준다: 최근 3개월 MRR 성장률만큼(최대 +60%)
  let pre = valuation(co, s.player.traits) * clamp(0.85 + co.irScore / 400, 0.85, 1.3) * (1 + growthPremium(co));
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
      out.push({ id: `${f}-${i}`, name: companyName(rng), faction: f, valuation: Math.round(uniform(rng, 250_000, 600_000)), momentum: uniform(rng, 0.03, 0.07) });
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

/** 이번 달 정산 뒤의 크런치 누적: 크런치 달 +1, 보통 달 -2 */
export function nextCrunchMonths(co: Company): number {
  return co.intensity === 'crunch' ? (co.crunchMonths ?? 0) + 1 : Math.max(0, (co.crunchMonths ?? 0) - 2);
}

/** 직원은 자기 능력치 상위 2개가 주 능력치인 업무를 좋아한다(만족도 월 +2, 아니면 -2). */
export function likesTask(stats: Stats, task: TaskId): boolean {
  const top2 = [...STATS].sort((a, b) => stats[b] - stats[a]).slice(0, 2);
  return top2.includes(TASKS[task].main);
}

export interface Worker { id: 'player' | string; who: string; stats: Stats; task: TaskId; mod: number; isPlayer: boolean }

/** 이번 달 일하는 사람: 오너 먼저, 그다음 입사 순 */
export function workersOf(state: GameState): Worker[] {
  const co = state.company;
  if (!co) return [];
  const p = state.player;
  return [
    { id: 'player', who: p.name, stats: effectiveStats(p), task: co.playerTask, mod: playerOutputMod(p.fatigue), isPlayer: true },
    ...co.employees.map((e) => ({ id: e.id, who: e.name, stats: e.stats, task: e.task, mod: satisfactionMod(e.satisfaction), isPlayer: false })),
  ];
}

/**
 * 한 사람이 한 업무에서 내는 월 성과.
 * crunch는 크런치 배수, noise는 정산에서는 난수(0.85~1.15)이고 예상에서는 1이다.
 */
export function workerOutput(state: GameState, w: Worker, task: TaskId, crunch: number, noise: number): number {
  const co = state.company!;
  const p = state.player;
  const t = TASKS[task];
  const missionOk = !!state.mission?.answered && state.mission.correct;
  // 오너가 학습 카드를 맞힌 달에는 오너 +20%, 팀 전체 +10%(방향을 잘 잡은 달). 직원 미션은 다음 단계에서 직원 플레이어가 한다.
  let missionBonus = missionOk ? (w.isPlayer ? 0.2 : TEAM_MISSION_BONUS) : 0;
  if (missionOk && w.isPlayer && p.traits.includes('hacker') && task === 'dev') missionBonus += 0.2;
  let out = 10 * fit(w.stats, t.main, t.sub) * w.mod * (1 + missionBonus) * noise;
  out *= crunch * (1 + (FACTIONS[co.faction].taskBonus[task] ?? 0)) * eventMult(eventFor(state.seed, state.month)?.id, co.faction, task);
  if (w.isPlayer) {
    if (task === 'sales' && p.traits.includes('closer')) out *= 1.15;
    if (task === 'ai' && p.traits.includes('researcher')) out *= 1.1;
  }
  if (task === 'dev' && p.traits.includes('architect')) out *= 1.05;
  out *= buffOutputMult(co, w.id, task);
  return Math.round(out * 10) / 10;
}

export interface Settled {
  outputs: { id: string; who: string; task: TaskId; output: number }[];
  /** 업무별 성과 합(체감 전) */
  rawSum: Record<TaskId, number>;
  /** 업무별 성과 합(체감 후, 실제 지표에 쓰이는 값) */
  sum: Record<TaskId, number>;
  usersDelta: number;
  revenue: number;
  costs: number;
  cashDelta: number;
}

/**
 * 한 달치 회사 정산(성과 → 지표 → 현금). s.company를 직접 바꾼다.
 * 실제 정산과 '다음 달 예상'이 이 함수를 같이 써서 두 계산이 어긋나지 않는다.
 */
function settleCompany(s: GameState, crunch: number, noise: () => number): Settled {
  const co = s.company!;
  const p = s.player;
  const burnout = Math.max(0, co.crunchMonths - CRUNCH_GRACE_MONTHS);

  // 1) 업무 성과
  const rawSum: Record<TaskId, number> = { dev: 0, ai: 0, plan: 0, sales: 0, marketing: 0, hiring: 0, finance: 0 };
  const outputs: Settled['outputs'] = [];
  for (const w of workersOf(s)) {
    const out = workerOutput(s, w, w.task, crunch, noise());
    rawSum[w.task] += out;
    outputs.push({ id: w.id, who: w.who, task: w.task, output: out });
  }

  // 2) 지표 반영 (한 업무에 몰린 성과는 체감)
  const sum = { ...rawSum };
  for (const t of Object.keys(sum) as TaskId[]) sum[t] = diminish(sum[t]);
  co.product = clamp(co.product + sum.dev * 0.35 * (1 - co.product / 110) + sum.ai * 0.15 * (1 - co.product / 110), 0, 100);
  co.aiScore += sum.ai;
  co.retentionBonus = Math.min(0.05, co.retentionBonus + sum.plan * 0.0008 * (p.traits.includes('designer') ? 1.2 : 1));
  const churn = clamp(0.08 - co.retentionBonus + (co.buffs ?? []).reduce((a, b) => a + (b.churnAdd ?? 0), 0), 0.01, 0.3);
  const adSpend = Math.min(co.adBudget ?? 0, Math.max(0, co.cash));
  const newUsers = sum.marketing * 25 * (0.4 + co.product / 100) * (1 + co.brand / 100) + co.product * 6 + adUsers(adSpend, co.product);
  const beforeUsers = co.users;
  co.users = Math.round(co.users * (1 - churn) + newUsers);
  co.brand = clamp(co.brand + sum.marketing * 0.2 * (1 - co.brand / 100), 0, 100);
  co.enterpriseMrr = co.enterpriseMrr * 0.98 + sum.sales * 25 * (co.product / 100);
  co.culture = clamp(co.culture + sum.hiring * 0.4 * (1 - co.culture / 100) - (co.intensity === 'crunch' ? 2 + burnout : 0) - 0.5, 0, 100);
  co.irScore = Math.min(200, co.irScore + sum.finance * 0.6);
  co.mrr = Math.round(co.users * arpu(co) * (co.product / 100) + co.enterpriseMrr);

  // 3) 현금 흐름
  const salaries = co.employees.reduce((a, e) => a + e.salary, 0);
  let costs = salaries + OFFICE_COST + 200 * co.employees.length;
  if (p.traits.includes('cfo')) costs *= 0.9;
  const savings = Math.min(costs * 0.3, sum.finance * 60);
  costs = Math.round(costs - savings + adSpend);
  const cashDelta = co.mrr - costs;
  co.cash = Math.round(co.cash + cashDelta);
  return { outputs, rawSum, sum, usersDelta: co.users - beforeUsers, revenue: co.mrr, costs, cashDelta };
}

export interface Forecast extends Settled {
  before: { product: number; users: number; mrr: number; cash: number; brand: number; culture: number };
  after: { product: number; users: number; mrr: number; cash: number; brand: number; culture: number };
}

/**
 * 지금 배정 그대로 한 달을 보냈을 때의 기대값. 난수(±15%)는 1로 두고, 상태는 바꾸지 않는다.
 * 학습 카드는 이미 맞힌 경우에만 반영한다.
 */
export function forecast(state: GameState): Forecast | null {
  if (state.phase !== 'play' || !state.company) return null;
  const s = clone(state);
  const co = s.company!;
  const snap = () => ({ product: co.product, users: co.users, mrr: co.mrr, cash: co.cash, brand: co.brand, culture: co.culture });
  const before = snap();
  co.crunchMonths = nextCrunchMonths(co);
  const crunch = co.intensity === 'crunch' ? crunchOutputMult(co.crunchMonths) : 1;
  const settled = settleCompany(s, crunch, () => 1);
  return { ...settled, before, after: snap() };
}

/** 한 사람을 각 업무에 보냈을 때의 예상 성과(난수 제외). 배정 화면의 비교용. */
export function previewOutputs(state: GameState, workerId: string): Record<TaskId, number> | null {
  const co = state.company;
  const w = workersOf(state).find((x) => x.id === workerId);
  if (!co || !w) return null;
  const months = nextCrunchMonths(co);
  const crunch = co.intensity === 'crunch' ? crunchOutputMult(months) : 1;
  const out = {} as Record<TaskId, number>;
  for (const t of Object.keys(TASKS) as TaskId[]) out[t] = workerOutput(state, w, t, crunch, 1);
  return out;
}

/** 후보의 추정 범위로 본 업무별 예상 성과 범위(입사 직후 만족도 60 기준). */
export function candidateOutputRange(state: GameState, c: Candidate, task: TaskId): { lo: number; hi: number } {
  const lo = {} as Stats;
  const hi = {} as Stats;
  for (const st of STATS) { lo[st] = c.estimate[st].lo; hi[st] = c.estimate[st].hi; }
  const mk = (stats: Stats): Worker => ({ id: c.id, who: c.name, stats, task, mod: satisfactionMod(60), isPlayer: false });
  return { lo: workerOutput(state, mk(lo), task, 1, 1), hi: workerOutput(state, mk(hi), task, 1, 1) };
}

/** 월급 extra를 더 쓰게 됐을 때의 런웨이(채용 제안 화면용) */
export function runwayWithExtraCost(co: Company, extra: number): number {
  const costs = co.employees.reduce((a, e) => a + e.salary, 0) + OFFICE_COST + 200 * co.employees.length + (co.adBudget ?? 0) + extra;
  const burn = costs - co.mrr;
  if (burn <= 0) return Infinity;
  return Math.max(0, co.cash / burn);
}

export function advanceMonth(state: GameState): GameState {
  if (state.phase !== 'play' || !state.company) return state;
  // 고르지 않은 결단 카드는 기본 선택지로 처리한다(매일 자동 정산과 같은 규칙)
  if (state.dilemma && state.dilemma.chosen === null) state = resolveDilemma(state, state.dilemma.defaultChoice, true);
  const s = clone(state);
  const co = s.company!;
  const p = s.player;
  const rng = rngFor(s.seed, 'settle', s.month);
  const ev = eventFor(s.seed, s.month);
  const report: MonthReport = {
    month: s.month, outputs: [], revenue: 0, costs: 0, cashDelta: 0, usersDelta: 0, resigned: [], growth: [], fatigueAfter: 0, event: ev ? `${ev.title}: ${ev.text}` : null,
  };
  co.crunchMonths = nextCrunchMonths(co);
  const crunch = co.intensity === 'crunch' ? crunchOutputMult(co.crunchMonths) : 1;
  const burnout = Math.max(0, co.crunchMonths - CRUNCH_GRACE_MONTHS);
  const tierFit = fitnessTier(p.exerciseDaysPerWeek);

  // 1~3) 업무 성과, 지표, 현금 흐름 (예상 계산과 같은 함수를 쓴다)
  const missionOk = !!s.mission?.answered && s.mission.correct;
  const settled = settleCompany(s, crunch, () => uniform(rng, 0.85, 1.15));
  report.outputs = settled.outputs.map(({ who, task, output }) => ({ who, task, output }));
  report.usersDelta = settled.usersDelta;
  report.revenue = settled.revenue;
  report.costs = settled.costs;
  report.cashDelta = settled.cashDelta;
  co.negativeCashMonths = co.cash < 0 ? co.negativeCashMonths + 1 : 0;
  co.buffs = (co.buffs ?? []).map((b) => ({ ...b, monthsLeft: b.monthsLeft - 1 })).filter((b) => b.monthsLeft > 0);

  // 4) 직원 만족도와 퇴사
  const keep: Employee[] = [];
  for (const e of co.employees) {
    const market = askingSalary(e.stats);
    let d = clamp(((e.salary / market) - 1) * 30, -5, 5);
    d += likesTask(e.stats, e.task) ? 2 : -2;
    d += (co.culture - 50) / 25;
    d += co.intensity === 'crunch' ? -3 - burnout : 1;
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
  s.dilemma = s.month < SEASON_MONTHS ? drawDilemma(s) : null;
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
  if (s.phase !== 'play') s.dilemma = null;
  return s;
}

/** 지금 비용과 매출이 그대로일 때 현금이 버티는 개월 수 */
export function runwayMonths(co: Company): number {
  const costs = co.employees.reduce((a, e) => a + e.salary, 0) + OFFICE_COST + 200 * co.employees.length + (co.adBudget ?? 0);
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
