import { describe, expect, it } from 'vitest';
import { canEquip, effectiveStats, fitnessTier, growthDelta, heuBonus, wearPoints } from './rules';
import { distribute, newGame, statTotal } from './game';
import * as G from './game';
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

describe('밸런스 장치', () => {
  const started = () => {
    let s = G.newGame('x');
    s = G.applyProfilePreset(s, 'engineer');
    s = G.setHeuBalance(s, 1_000_000);
    s = G.finishAvatar(s);
    return G.foundCompany(s, 'T', 'north');
  };

  it('창업 직후 오너 기본 업무는 매출·제품으로 이어지는 업무다(HEU가 많아도 AI가 아니다)', () => {
    expect(['dev', 'plan', 'sales', 'marketing']).toContain(started().company!.playerTask);
  });

  it('월급은 시장가 70% 아래로 깎을 수 없고, 깎으면 만족도가 바로 떨어진다', () => {
    let s = started();
    s.candidates = s.candidates.slice(0, 1);
    const c = s.candidates[0]!;
    s = G.offer(s, c.id, c.ask, 'dev').state;
    const e = s.company!.employees[0]!;
    const after = G.setSalary(s, e.id, 0).company!.employees[0]!;
    expect(after.salary).toBe(G.salaryFloor(e.stats));
    expect(after.salary).toBeGreaterThan(0);
    expect(after.satisfaction).toBeLessThan(e.satisfaction - 10);
    // 올리는 것은 만족도를 바로 깎지 않는다
    expect(G.setSalary(s, e.id, e.salary + 500).company!.employees[0]!.satisfaction).toBe(e.satisfaction);
  });

  it('회사 가치에 보유 현금이 들어간다', () => {
    const co = started().company!;
    const v = G.valuation(co);
    expect(G.valuation({ ...co, cash: co.cash + 100_000 })).toBe(v + 100_000);
    expect(G.valuation({ ...co, cash: -5_000 })).toBe(G.valuation({ ...co, cash: 0 }));
  });

  it('크런치 보너스는 2개월 뒤부터 줄어 최저 0.8배다', () => {
    expect(G.crunchOutputMult(0)).toBe(1);
    expect(G.crunchOutputMult(2)).toBeCloseTo(1.2);
    expect(G.crunchOutputMult(4)).toBeCloseTo(1.0);
    expect(G.crunchOutputMult(20)).toBeCloseTo(0.8);
  });

  it('한 업무에 몰린 성과와 광고 예산은 체감한다', () => {
    expect(G.diminish(10)).toBe(10);
    expect(G.diminish(60)).toBeLessThan(60 * 0.75);
    const a = G.adUsers(10_000, 50);
    expect(G.adUsers(20_000, 50)).toBeLessThan(2 * a);
    expect(G.adUsers(0, 50)).toBe(0);
  });
});
