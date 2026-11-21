import { describe, expect, it } from 'vitest';
import { canEquip, effectiveStats, fitnessTier, growthDelta, heuBonus, wearPoints } from './rules';
import { distribute, newGame, statTotal } from './game';
import { PROFILE_PRESETS, STAT_TOTAL } from './data';

describe('HEU 가산', () => {
  it('설계서 표와 같다', () => {
    expect(heuBonus(999)).toBe(0);
    expect(heuBonus(1_000)).toBeCloseTo(3);
    expect(heuBonus(10_000)).toBeCloseTo(6);
    expect(heuBonus(100_000)).toBeCloseTo(9);
    expect(heuBonus(1_000_000)).toBeCloseTo(12);
    expect(heuBonus(1e12)).toBe(12);
  });
});

describe('체력 단계', () => {
  it('주 3일 이상 운동한 주의 수로 정하고 강도는 보지 않는다', () => {
    expect(fitnessTier([0, 0, 0, 0])).toBe(0);
    expect(fitnessTier([3, 0, 0, 0])).toBe(1);
    expect(fitnessTier([3, 3, 3, 0])).toBe(2);
    expect(fitnessTier([3, 3, 3, 3])).toBe(3);
    expect(fitnessTier([7, 7, 7, 7])).toBe(3);
  });
});

describe('성장식', () => {
  it('수업 2칸을 56개월 하면 50은 약 72가 된다', () => {
    let s = 50;
    for (let m = 0; m < 56; m++) for (let k = 0; k < 2; k++) s += growthDelta(s, 1);
    expect(s).toBeGreaterThan(70);
    expect(s).toBeLessThan(74);
  });
});

describe('능력치 배분', () => {
  it('어떤 프로필이든 총합은 고정이다', () => {
    for (const p of Object.values(PROFILE_PRESETS)) expect(statTotal(distribute(p.weights, STAT_TOTAL))).toBe(STAT_TOTAL);
  });
});

describe('착용 한도', () => {
  it('새 아바타는 착용 포인트 4를 넘길 수 없다', () => {
    const s = newGame('x');
    s.player.inventory = ['laptop-pro', 'mech-keyboard'];
    s.player.equipped = ['laptop-pro'];
    expect(wearPoints(0)).toBe(4);
    expect(canEquip(s.player, 'mech-keyboard').ok).toBe(false);
    s.player.careerMonths = 12;
    expect(canEquip(s.player, 'mech-keyboard').ok).toBe(true);
  });

  it('장비와 HEU를 합친 외부 가산은 능력치당 +15가 상한이다', () => {
    const s = newGame('x');
    s.player.careerMonths = 60;
    s.player.equipped = ['gpu-credit', 'paper-sub'];
    s.player.heuBalance = 1_000_000;
    const base = s.player.stats.ai;
    expect(effectiveStats(s.player).ai).toBe(base + 15);
  });
});
