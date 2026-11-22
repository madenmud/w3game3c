// 밸런스 검증용 자동 플레이어. 테스트와 수치 점검에서만 쓴다.
import { MISSIONS, TASKS } from './data';
import * as G from './game';
import { resolveDilemma } from './dilemmas';
import { rngFor } from './rng';
import { fit } from './rules';
import type { GameState, TaskId } from './types';

/** 결단 카드를 고르는 방식: 기본 선택지(방치), 늘 첫 번째, 무작위, 참모 다수결, 직접 함수 */
export type DilemmaPolicy = 'default' | 'first' | 'random' | 'advice' | ((s: GameState) => number);

export type BotStyle = 'good' | 'idle' | 'reckless';

/** 전략 봇 설정. 기본값은 '성실한 운영'이고, 한 가지씩 바꿔 악용 전략을 흉내 낸다. */
export interface Strategy {
  /** 직원에게 맡길 업무 순서(채용 순서대로 돌아가며). 기본은 균형 배치 */
  tasks?: TaskId[];
  /** 투자 제안을 받는가 */
  acceptOffers?: boolean;
  /** 채용 직후 월급을 최대한 깎는가 */
  cutSalary?: boolean;
  /** 늘 크런치로 돌리는가 */
  alwaysCrunch?: boolean;
  /** 광고 예산을 쓰는가(현금의 일정 비율) */
  useAds?: boolean;
  /** 학습 카드를 맞히는가 */
  missionCorrect?: boolean;
  /** 오너 업무. 생략하면 창업 때 정해진 기본 업무 */
  playerTask?: TaskId;
  /** 프로필 프리셋과 HEU */
  preset?: string;
  heu?: number;
  maxEmployees?: number;
  /** 결단 카드 방식. 기본은 'default'(고르지 않고 정산) */
  dilemma?: DilemmaPolicy;
}

export function chooseDilemma(s: GameState, policy: DilemmaPolicy = 'default'): number {
  const d = s.dilemma!;
  if (typeof policy === 'function') return policy(s);
  if (policy === 'first') return 0;
  if (policy === 'random') return Math.floor(rngFor(s.seed, 'bot-dilemma', s.month)() * d.choices.length);
  if (policy === 'advice') {
    const votes = d.choices.map((_, i) => d.advice.filter((a) => a.pick === i).length);
    const max = Math.max(...votes);
    return max > 0 ? votes.indexOf(max) : d.defaultChoice;
  }
  return d.defaultChoice;
}

const BALANCED: TaskId[] = ['dev', 'marketing', 'sales', 'plan', 'finance', 'ai'];

function pickFor(s: GameState, need: TaskId) {
  const t = TASKS[need];
  return [...s.candidates].sort((a, b) => fit(b.stats, t.main, t.sub) - fit(a.stats, t.main, t.sub))[0];
}

export function playStrategy(seed: string, o: Strategy = {}): GameState {
  let s = G.newGame(seed);
  s = G.applyProfilePreset(s, o.preset ?? 'engineer');
  if (o.heu) s = G.setHeuBalance(s, o.heu);
  s = G.finishAvatar(s);
  s = G.foundCompany(s, '테스트 컴퍼니', 'north');
  if (o.playerTask) s = G.assignTask(s, 'player', o.playerTask);
  return playOn(s, o);
}

/** 지금 상태에서 시즌 끝까지 전략대로 이어서 둔다(결단 카드 분기 비교용). */
export function playOn(start: GameState, o: Strategy = {}, until?: (s: GameState) => boolean): GameState {
  let s = start;
  const tasks = o.tasks ?? BALANCED;
  const maxEmp = o.maxEmployees ?? 6;
  let guard = 0;
  while (s.phase === 'play' && guard++ < 100) {
    if (until?.(s)) return s;
    if (s.dilemma && s.dilemma.chosen === null && (o.dilemma ?? 'default') !== 'default') s = resolveDilemma(s, chooseDilemma(s, o.dilemma));
    const co = s.company!;
    // 채용: 고정비 8개월치 이상 현금이 남을 때 한 명씩
    const monthly = co.employees.reduce((a, e) => a + e.salary, 0) + 1000 + co.adBudget;
    if (co.employees.length < maxEmp && s.candidates.length && co.cash > (monthly + 3000) * 8) {
      // 아직 아무도 맡지 않은 업무부터 채운다(결단 카드로 들어온 사람이 있어도 균형이 깨지지 않게)
      const need = tasks.find((t) => !co.employees.some((e) => e.task === t)) ?? tasks[co.employees.length % tasks.length]!;
      const c = pickFor(s, need);
      if (c) {
        s = G.delegateInterview(s, c.id);
        s = G.offer(s, c.id, Math.ceil(G.acceptanceThreshold(s, c) / 50) * 50, need).state;
      }
    }
    if (!o.tasks) {
      // 결단 카드로 들어온 사람 때문에 업무가 겹치면 빈 업무로 옮긴다(사람이라면 그렇게 한다)
      for (const e of s.company!.employees) {
        const cur = s.company!.employees;
        const dup = cur.filter((x) => x.task === e.task).length > 1;
        const free = tasks.find((t) => !cur.some((x) => x.task === t));
        if (dup && free) s = G.assignTask(s, e.id, free);
      }
    }
    for (const e of s.company!.employees) {
      if (o.cutSalary) s = G.setSalary(s, e.id, 0);
      else if (e.satisfaction < 45) s = G.setSalary(s, e.id, e.salary * 1.1);
    }
    s = G.setIntensity(s, o.alwaysCrunch ? 'crunch' : 'normal');
    if (o.useAds) {
      // 18개월 버틸 만큼만 광고에 쓴다
      const c2 = s.company!;
      s = G.setAdBudget(s, Math.max(0, c2.cash) / 18);
    }
    if (s.mission && !s.mission.answered) {
      const card = MISSIONS.find((m) => m.id === s.mission!.cardId)!;
      s = G.answerMission(s, o.missionCorrect === false ? (card.answer + 1) % card.choices.length : card.answer);
    }
    s = G.setSchedule(s, 1, s.player.fatigue > 55 ? { kind: 'rest' } : { kind: 'study', stat: 'dev' });
    if (s.player.pendingTraitChoice) {
      s = G.chooseTrait(s, s.player.pendingTraitChoice.stat === 'dev' ? 'architect' : 'researcher');
    }
    if (o.acceptOffers !== false) for (const of of [...s.offers]) s = G.acceptOffer(s, of.round);
    s = G.advanceMonth(s);
  }
  return s;
}

/** 기존 테스트용 세 가지 스타일 */
export function playSeason(seed: string, style: BotStyle, opts: { missionCorrect?: boolean } = {}): GameState {
  if (style === 'good') return playStrategy(seed, { useAds: true, missionCorrect: opts.missionCorrect, playerTask: 'dev', dilemma: 'advice' });
  let s = G.newGame(seed);
  s = G.applyProfilePreset(s, 'engineer');
  s = G.finishAvatar(s);
  s = G.foundCompany(s, '테스트 컴퍼니', 'north');
  s = G.assignTask(s, 'player', 'dev');
  let guard = 0;
  while (s.phase === 'play' && guard++ < 100) {
    if (style === 'reckless') {
      while (s.company!.employees.length < 8 && s.candidates.length) {
        const c = s.candidates[0]!;
        s = G.offer(s, c.id, c.ask * 2, G.bestTaskFor(c.stats)).state;
      }
    }
    s = G.advanceMonth(s);
  }
  return s;
}
