import { describe, expect, it } from 'vitest';
import { playOn, playStrategy, type DilemmaPolicy, type Strategy } from './bots';
import { adviceError, DILEMMAS, drawDilemma, resolveDilemma } from './dilemmas';
import * as G from './game';
import type { GameState } from './types';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const GOOD: Strategy = { useAds: true, playerTask: 'dev' };
const score = (dilemma: DilemmaPolicy) => avg(SEEDS.map((s) => G.finalScore(playStrategy(s, { ...GOOD, dilemma }))));

function started(seed: string): GameState {
  let s = G.newGame(seed);
  s = G.applyProfilePreset(s, 'engineer');
  s = G.finishAvatar(s);
  s = G.foundCompany(s, '테스트', 'north');
  return G.assignTask(s, 'player', 'dev');
}

describe('결단 카드', () => {
  it('첫 달은 조용하고, 둘째 달부터 매달 카드가 나온다', () => {
    const s = started('a');
    expect(s.dilemma ?? null).toBeNull();
    let t = G.advanceMonth(s);
    let n = 0;
    for (let i = 0; i < 12 && t.phase === 'play'; i++) { if (t.dilemma) n++; t = G.advanceMonth(t); }
    expect(n).toBeGreaterThanOrEqual(11);
  });

  it('고르지 않고 정산하면 기본 선택지가 적용되고 기록에 남는다', () => {
    const s = G.advanceMonth(started('b'));
    const d = s.dilemma!;
    const next = G.advanceMonth(s);
    expect(next.log.some((l) => l.text.startsWith(`[${d.title}] 결정을 미뤘다 → ${d.choices[d.defaultChoice]!.label}`))).toBe(true);
  });

  it('한 번 고르면 다시 고를 수 없고, 결과 글이 남는다', () => {
    const s = G.advanceMonth(started('c'));
    const r = resolveDilemma(s, 0);
    expect(r.dilemma!.chosen).toBe(0);
    expect(r.dilemma!.result).toBeTruthy();
    expect(resolveDilemma(r, 1)).toBe(r);
  });

  it('같은 카드는 10개월 안에 다시 나오지 않는다', () => {
    const end = playStrategy('d', { ...GOOD, dilemma: 'first' });
    const seen = end.log.filter((l) => l.text.startsWith('[')).map((l) => ({ m: l.month, t: l.text.slice(0, l.text.indexOf(']')) }));
    for (const x of seen) {
      const again = seen.find((y) => y.t === x.t && y.m > x.m);
      if (again) expect(again.m - x.m).toBeGreaterThanOrEqual(10);
    }
  });

  it('몇 달짜리 효과는 기간이 끝나면 사라진다', () => {
    let s = started('e');
    s = { ...s, company: { ...s.company!, buffs: [{ label: 't', monthsLeft: 2, task: 'dev', mult: 0.5 }] } };
    const p0 = G.previewOutputs(s, 'player')!.dev;
    s = G.advanceMonth(s);
    s = G.advanceMonth(s);
    expect(s.company!.buffs!.some((b) => b.label === 't')).toBe(false);
    expect(G.previewOutputs(s, 'player')!.dev).toBeGreaterThan(p0);
  });

  it('같은 시드와 같은 선택은 같은 결과를 낸다', () => {
    const a = playStrategy('f', { ...GOOD, dilemma: 'random' });
    const b = playStrategy('f', { ...GOOD, dilemma: 'random' });
    expect(G.finalScore(a)).toBe(G.finalScore(b));
  });
});

describe('참모 조언', () => {
  it('능력치가 높을수록 성공 확률을 정확하게 말한다', () => {
    expect(adviceError(90)).toBeLessThan(adviceError(50));
    expect(adviceError(50)).toBeLessThan(adviceError(25));
    expect(adviceError(95)).toBeGreaterThanOrEqual(4);
  });

  it('직원이 있으면 최대 3명이 조언하고, 카드의 당사자는 조언하지 않는다', () => {
    let s = started('g');
    s = playOn(s, GOOD, (x) => x.month >= 20);
    const d = drawDilemma(s);
    expect(d).not.toBeNull();
    expect(d!.advice.length).toBeGreaterThan(0);
    expect(d!.advice.length).toBeLessThanOrEqual(3);
    if (d!.id === 'poach' || d!.id === 'burnout') {
      const target = s.company!.employees.find((e) => e.id === d!.params.emp)!;
      expect(d!.advice.some((a) => a.who.startsWith(target.name + ' '))).toBe(false);
    }
  });
});

describe('결단 밸런스(자동 플레이어)', () => {
  const ignore = score('default');

  it('결단을 내리면(참모 다수결) 방치보다 20% 이상 높다', () => {
    expect(score('advice')).toBeGreaterThan(1.2 * ignore);
  });

  it('어떤 고정 방식으로 골라도 성실한 운영은 파산하지 않는다', () => {
    for (const pol of ['default', 'first', 'random', 'advice'] as const) {
      for (const seed of SEEDS.slice(0, 6)) expect(playStrategy(seed, { ...GOOD, dilemma: pol }).endReason).toBe('season');
    }
  });

  // 흥미로운 결정: 어느 선택지도 모든 판에서 이기면 안 된다(정답이 상황마다 달라야 한다)
  for (const def of DILEMMAS.filter((d) => d.id !== 'bridge')) {
    it(`'${def.id}': 한 선택지가 90% 넘게 이기지 않는다`, () => {
      const wins: number[] = [];
      let n = 0;
      // 공동창업 카드는 첫 몇 달에만 나와서 시드를 더 쓴다
      const seeds = def.id === 'cofounder' ? Array.from({ length: 40 }, (_, i) => `cf${i}`) : SEEDS;
      for (const seed of seeds) {
        const o: Strategy = { ...GOOD, dilemma: 'advice' };
        // 자동 플레이어는 첫 달에 바로 채용하므로, 공동창업 카드는 첫 달을 그냥 넘긴 판에서 본다
        const begin = def.id === 'cofounder' ? G.advanceMonth(started(seed)) : started(seed);
        const at = playOn(begin, o, (x) => x.dilemma?.id === def.id && x.dilemma.chosen === null);
        if (at.phase !== 'play' || at.dilemma?.id !== def.id) continue;
        n++;
        const sc = at.dilemma!.choices.map((_, c) => G.finalScore(playOn(resolveDilemma(at, c), o)));
        const b = sc.indexOf(Math.max(...sc));
        wins[b] = (wins[b] ?? 0) + 1;
      }
      expect(n).toBeGreaterThanOrEqual(8);
      expect(Math.max(...wins.map((w) => w ?? 0)) / n).toBeLessThanOrEqual(0.9);
    }, 60_000);
  }
});
