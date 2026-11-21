// 밸런스 검증용 자동 플레이어. 테스트와 수치 점검에서만 쓴다.
import { MISSIONS, TASKS } from './data';
import * as G from './game';
import { fit } from './rules';
import type { GameState, TaskId } from './types';

export type BotStyle = 'good' | 'idle' | 'reckless';

function bestTask(stats: GameState['player']['stats'], exclude: TaskId[] = []): TaskId {
  let best: TaskId = 'dev';
  let bf = -1;
  for (const t of Object.values(TASKS)) {
    if (exclude.includes(t.id)) continue;
    const f = fit(stats, t.main, t.sub);
    if (f > bf) { bf = f; best = t.id; }
  }
  return best;
}

export function playSeason(seed: string, style: BotStyle, opts: { missionCorrect?: boolean } = {}): GameState {
  let s = G.newGame(seed);
  s = G.applyProfilePreset(s, 'engineer');
  s = G.finishAvatar(s);
  s = G.foundCompany(s, '테스트 컴퍼니', 'north');
  s = G.assignTask(s, 'player', 'dev');
  let guard = 0;
  while (s.phase === 'play' && guard++ < 100) {
    const co = s.company!;
    if (style === 'good') {
      // 현금 여유가 있으면 1명씩 채용 (월 비용의 8개월치 이상 남을 때)
      const monthly = co.employees.reduce((a, e) => a + e.salary, 0) + 1000;
      const want = co.product < 60 ? ['dev', 'marketing', 'sales', 'plan', 'finance'] : ['sales', 'marketing', 'dev', 'plan', 'hiring', 'finance'];
      if (co.employees.length < 6 && co.cash > (monthly + 3000) * 8 && s.candidates.length) {
        const need = want.find((t) => !co.employees.some((e) => e.task === t)) as TaskId | undefined ?? 'sales';
        const c = [...s.candidates].sort((a, b) => fit(b.stats, TASKS[need].main, TASKS[need].sub) - fit(a.stats, TASKS[need].main, TASKS[need].sub))[0]!;
        s = G.delegateInterview(s, c.id);
        s = G.offer(s, c.id, Math.ceil(G.acceptanceThreshold(s, c) / 50) * 50, need).state;
      }
      for (const e of s.company!.employees) if (e.satisfaction < 45) s = G.setSalary(s, e.id, e.salary * 1.1);
      if (s.mission && !s.mission.answered) {
        const card = MISSIONS.find((m) => m.id === s.mission!.cardId)!;
        s = G.answerMission(s, opts.missionCorrect === false ? (card.answer + 1) % card.choices.length : card.answer);
      }
      if (s.player.fatigue > 55) s = G.setSchedule(s, 1, { kind: 'rest' });
      else s = G.setSchedule(s, 1, { kind: 'study', stat: 'dev' });
      if (s.player.pendingTraitChoice) {
        s = G.chooseTrait(s, s.player.pendingTraitChoice.stat === 'dev' ? 'architect' : 'researcher');
      }
      for (const o of [...s.offers]) s = G.acceptOffer(s, o.round);
    } else if (style === 'reckless') {
      while (s.company!.employees.length < 8 && s.candidates.length) {
        const c = s.candidates[0]!;
        s = G.offer(s, c.id, c.ask * 2, bestTask(c.stats)).state;
      }
    }
    s = G.advanceMonth(s);
  }
  return s;
}
