import { describe, expect, it } from 'vitest';
import { playSeason, playStrategy, type Strategy } from './bots';
import { finalScore } from './game';
import type { TaskId } from './types';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const GOOD: Strategy = { useAds: true, playerTask: 'dev' };
const score = (o: Strategy) => avg(SEEDS.map((s) => finalScore(playStrategy(s, o))));

describe('밸런스(자동 플레이어로 한 시즌)', () => {
  const good = SEEDS.map((s) => playSeason(s, 'good'));
  const idle = SEEDS.map((s) => playSeason(s, 'idle'));
  const reckless = SEEDS.map((s) => playSeason(s, 'reckless'));
  const goodScore = avg(good.map(finalScore));

  it('성실한 운영은 시즌을 버티고 시리즈 A 이상에 도달한다', () => {
    for (const s of good) {
      expect(s.endReason).toBe('season');
      expect(s.company!.roundIndex).toBeGreaterThanOrEqual(3);
    }
  });

  it('성실한 운영이 방치보다 최종 점수가 2배 이상 높다', () => {
    expect(goodScore).toBeGreaterThan(2 * avg(idle.map(finalScore)));
  });

  it('방치해도 파산하지는 않는다(오프라인 보호)', () => {
    for (const s of idle) expect(s.endReason).toBe('season');
  });

  it('과도한 채용·고연봉은 파산한다', () => {
    for (const s of reckless) expect(s.endReason).toBe('bankrupt');
  });

  it('미션을 맞히면 점수가 오른다', () => {
    expect(goodScore).toBeGreaterThan(score({ ...GOOD, missionCorrect: false }));
  });

  it('같은 시드는 같은 결과를 낸다(결정적 정산)', () => {
    expect(finalScore(playSeason('a', 'good'))).toBe(finalScore(good[0]!));
  });
});

// 평가에서 찾은 악용·함정 전략이 성실한 운영을 이기지 못하는지 지킨다.
describe('전략 봇: 악용 전략이 이기지 못한다', () => {
  const goodScore = score(GOOD);

  it('투자를 받는 쪽이 거절하는 쪽보다 20% 이상 낫다', () => {
    expect(goodScore).toBeGreaterThan(1.2 * score({ ...GOOD, acceptOffers: false }));
  });

  it('채용 후 월급을 깎아도 성실한 운영보다 낮다', () => {
    expect(score({ ...GOOD, cutSalary: true })).toBeLessThan(goodScore);
  });

  it('늘 크런치로 돌리면 보통 강도보다 낮다', () => {
    expect(score({ ...GOOD, alwaysCrunch: true })).toBeLessThan(goodScore);
  });

  const MONO: TaskId[] = ['marketing', 'sales', 'dev', 'ai', 'plan'];
  for (const t of MONO) {
    it(`직원 전원을 한 업무(${t})에 몰면 균형 배치보다 낮다`, () => {
      expect(score({ ...GOOD, tasks: [t] })).toBeLessThan(goodScore);
    });
  }

  it('광고 예산은 성장에 도움이 되지만 파산을 부르지 않는다', () => {
    const noAds = score({ playerTask: 'dev' });
    expect(goodScore).toBeGreaterThan(noAds);
    for (const s of SEEDS) expect(playStrategy(s, GOOD).endReason).toBe('season');
  });
});
