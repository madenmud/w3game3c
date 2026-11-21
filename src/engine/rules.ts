// 설계서의 수치 규칙. UI와 무관한 순수 함수만 둔다.
import { clamp } from './rng';
import { ITEMS, STAT_MAX } from './data';
import { STATS, type Avatar, type Stat, type Stats } from './types';

/** HEU 보유량 → AI·지식 가산. min(12, 3 + 3·log10(보유/1000)), 1,000 미만은 0 */
export function heuBonus(balance: number): number {
  if (!(balance >= 1000)) return 0;
  return Math.min(12, 3 + 3 * Math.log10(balance / 1000));
}

/** 운동 연동 → 체력 단계(0~3). 최근 4주 중 '주 3일 이상' 운동한 주의 수로 정한다. 강도는 보지 않는다. */
export function fitnessTier(exerciseDaysPerWeek: number[]): number {
  const goodWeeks = exerciseDaysPerWeek.slice(-4).filter((d) => d >= 3).length;
  if (goodWeeks >= 4) return 3;
  if (goodWeeks >= 3) return 2;
  if (goodWeeks >= 1) return 1;
  return 0;
}

/** 착용 포인트 = 4 + 경력개월/6, 최대 14 */
export function wearPoints(careerMonths: number): number {
  return Math.min(14, 4 + Math.floor(careerMonths / 6));
}
export const WEAR_SLOTS = 4;
export const EXTERNAL_CAP_PER_STAT = 15;

export function gearBonusOf(equipped: string[]): Stats {
  const b = zeroStats();
  for (const id of equipped) {
    const it = ITEMS.find((i) => i.id === id);
    if (it && it.kind === 'gear') b[it.stat] += it.bonus;
  }
  return b;
}

export function zeroStats(): Stats {
  return { leadership: 0, dev: 0, plan: 0, sales: 0, finance: 0, ai: 0 };
}

/** 장비를 하나 더 착용할 수 있는지와 이유 */
export function canEquip(av: Avatar, itemId: string): { ok: boolean; reason?: string } {
  const it = ITEMS.find((i) => i.id === itemId);
  if (!it) return { ok: false, reason: '없는 아이템' };
  if (av.equipped.includes(itemId)) return { ok: false, reason: '이미 착용 중' };
  if (it.kind === 'cosmetic') return { ok: true };
  const gearCount = av.equipped.filter((id) => ITEMS.find((i) => i.id === id)?.kind === 'gear').length;
  if (gearCount >= WEAR_SLOTS) return { ok: false, reason: `착용 슬롯 ${WEAR_SLOTS}칸이 모두 찼어요` };
  const used = av.equipped.reduce((s, id) => s + (ITEMS.find((i) => i.id === id)?.bonus ?? 0), 0);
  const limit = wearPoints(av.careerMonths);
  if (used + it.bonus > limit) return { ok: false, reason: `착용 포인트 초과 (${used + it.bonus}/${limit})` };
  return { ok: true };
}

/** 실제 업무에 쓰이는 능력치: 기본 + 장비 + HEU(AI·지식), 외부 가산은 능력치당 +15 상한 */
export function effectiveStats(av: Avatar): Stats {
  const gear = gearBonusOf(av.equipped);
  const out = zeroStats();
  for (const s of STATS) {
    let ext = gear[s];
    if (s === 'ai') ext += heuBonus(av.heuBalance);
    ext = Math.min(EXTERNAL_CAP_PER_STAT, ext);
    out[s] = clamp(av.stats[s] + ext, 0, 110);
  }
  return out;
}

/** 업무 적합도 (0.7·주 + 0.3·보조) / 50 */
export function fit(stats: Stats, main: Stat, sub: Stat): number {
  return (0.7 * stats[main] + 0.3 * stats[sub]) / 50;
}

/** 만족도 → 성과 배수 0.7~1.3 */
export function satisfactionMod(sat: number): number {
  return 0.7 + 0.6 * clamp(sat, 0, 100) / 100;
}

/** 개인 성장: ΔS = 0.4 × (1 − S/120) × 효율 */
export function growthDelta(current: number, efficiency: number): number {
  if (current >= STAT_MAX) return 0;
  return 0.4 * (1 - current / 120) * efficiency;
}

/** 피로 → 수업 효율 보정 */
export function fatigueEfficiency(fatigue: number): number {
  return fatigue > 60 ? 0.5 : 1;
}
