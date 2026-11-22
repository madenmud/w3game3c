import { describe, expect, it } from 'vitest';
import { TASK_IDS } from './data';
import * as G from './game';
import type { GameState } from './types';

function started(seed: string): GameState {
  let s = G.newGame(seed);
  s = G.applyProfilePreset(s, 'engineer');
  s = G.finishAvatar(s);
  s = G.foundCompany(s, '예상 테스트', 'south');
  for (const c of s.candidates.slice(0, 3)) s = G.offer(s, c.id, c.ask, G.bestTaskFor(c.stats)).state;
  s = G.setAdBudget(s, 2000);
  return s;
}

describe('다음 달 예상', () => {
  it('상태를 바꾸지 않는다', () => {
    const s = started('f1');
    const copy = JSON.stringify(s);
    G.forecast(s);
    G.previewOutputs(s, 'player');
    expect(JSON.stringify(s)).toBe(copy);
  });

  it('실제 정산과 같은 식을 쓴다: 개인 성과는 난수 ±15% 안에 든다', () => {
    for (const seed of ['f1', 'f2', 'f3', 'f4']) {
      let s = started(seed);
      for (let m = 0; m < 12 && s.phase === 'play'; m++) {
        if (m === 4) s = G.setIntensity(s, 'crunch');
        const f = G.forecast(s)!;
        const next = G.advanceMonth(s);
        const real = next.lastReport!;
        expect(real.outputs.length).toBe(f.outputs.length);
        real.outputs.forEach((o, i) => {
          const exp = f.outputs[i]!.output;
          expect(o.task).toBe(f.outputs[i]!.task);
          expect(o.output).toBeGreaterThanOrEqual(exp * 0.85 - 0.11);
          expect(o.output).toBeLessThanOrEqual(exp * 1.15 + 0.11);
        });
        // 비용은 재무 성과의 절감분만 난수를 탄다
        expect(Math.abs(real.costs - f.costs)).toBeLessThanOrEqual(Math.max(200, f.costs * 0.1));
        s = next;
      }
    }
  });

  it('업무별 미리보기는 지금 배정의 예상 성과와 일치한다', () => {
    const s = started('f5');
    const f = G.forecast(s)!;
    for (const w of G.workersOf(s)) {
      const pv = G.previewOutputs(s, w.id)!;
      expect(pv[w.task]).toBe(f.outputs.find((o) => o.id === w.id)!.output);
      for (const t of TASK_IDS) expect(pv[t]).toBeGreaterThan(0);
    }
  });

  it('한 업무에 몰면 체감 후 합이 체감 전보다 작다', () => {
    let s = started('f6');
    s = G.assignTask(s, 'player', 'dev');
    for (const e of s.company!.employees) s = G.assignTask(s, e.id, 'dev');
    const f = G.forecast(s)!;
    expect(f.rawSum.dev).toBeGreaterThan(10);
    expect(f.sum.dev).toBeLessThan(f.rawSum.dev);
  });

  it('후보 예상 성과 범위는 진짜 능력치로 낸 성과를 포함한다', () => {
    const s = started('f7');
    for (const c of s.candidates) {
      for (const t of TASK_IDS) {
        const r = G.candidateOutputRange(s, c, t);
        const real = G.candidateOutputRange(s, { ...c, estimate: Object.fromEntries(Object.entries(c.stats).map(([k, v]) => [k, { lo: v, hi: v }])) as typeof c.estimate }, t);
        expect(r.lo).toBeLessThanOrEqual(real.lo);
        expect(r.hi).toBeGreaterThanOrEqual(real.hi);
      }
    }
  });
});
