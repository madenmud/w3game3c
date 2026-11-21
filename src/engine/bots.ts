// 밸런스 검증용 자동 플레이어. 테스트와 수치 점검에서만 쓴다.
import { MISSIONS, TASKS } from './data';
import * as G from './game';
import { fit } from './rules';
import type { GameState, TaskId } from './types';

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
  const tasks = o.tasks ?? BALANCED;
  const maxEmp = o.maxEmployees ?? 6;
  let guard = 0;
  while (s.phase === 'play' && guard++ < 100) {
    const co = s.company!;
    // 채용: 고정비 8개월치 이상 현금이 남을 때 한 명씩
    const monthly = co.employees.reduce((a, e) => a + e.salary, 0) + 1000 + co.adBudget;
    if (co.employees.length < maxEmp && s.candidates.length && co.cash > (monthly + 3000) * 8) {
      const need = tasks[co.employees.length % tasks.length]!;
      const c = pickFor(s, need);
      if (c) {
        s = G.delegateInterview(s, c.id);
        s = G.offer(s, c.id, Math.ceil(G.acceptanceThreshold(s, c) / 50) * 50, need).state;
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
  if (style === 'good') return playStrategy(seed, { useAds: true, missionCorrect: opts.missionCorrect, playerTask: 'dev' });
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
