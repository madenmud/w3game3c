import { describe, expect, it } from 'vitest';
import { playSeason } from './bots';
import { finalScore } from './game';

const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'];
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('밸런스(자동 플레이어로 한 시즌)', () => {
  const good = SEEDS.map((s) => playSeason(s, 'good'));
  const idle = SEEDS.map((s) => playSeason(s, 'idle'));
  const reckless = SEEDS.map((s) => playSeason(s, 'reckless'));

  it('성실한 운영은 시즌을 버티고 시리즈 A 이상에 도달한다', () => {
    for (const s of good) {
      expect(s.endReason).toBe('season');
      expect(s.company!.roundIndex).toBeGreaterThanOrEqual(3);
    }
  });

  it('성실한 운영이 방치보다 최종 점수가 2배 이상 높다', () => {
    expect(avg(good.map(finalScore))).toBeGreaterThan(2 * avg(idle.map(finalScore)));
  });

  it('방치해도 파산하지는 않는다(오프라인 보호)', () => {
    for (const s of idle) expect(s.endReason).toBe('season');
  });

  it('과도한 채용·고연봉은 파산한다', () => {
    for (const s of reckless) expect(s.endReason).toBe('bankrupt');
  });

  it('미션을 맞히면 점수가 오른다', () => {
    const wrong = SEEDS.map((s) => playSeason(s, 'good', { missionCorrect: false }));
    expect(avg(good.map(finalScore))).toBeGreaterThan(avg(wrong.map(finalScore)));
  });

  it('같은 시드는 같은 결과를 낸다(결정적 정산)', () => {
    expect(finalScore(playSeason('a', 'good'))).toBe(finalScore(good[0]!));
  });
});
