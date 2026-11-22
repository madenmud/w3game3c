// 화면 공용 조각
import { STAT_LABEL, TASKS, TRAIT_TREE } from '../engine/data';
import * as G from '../engine/game';
import { fit } from '../engine/rules';
import type { GameState, Stats, TaskId } from '../engine/types';

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const money = G.fmtMoney;
export const r0 = (n: number) => Math.round(n);

export function bar(value: number, max = 100, tone = '') {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="bar ${tone}"><span style="width:${pct}%"></span></span>`;
}

/** 부호가 붙은 변화량. fmt는 절댓값을 글자로 바꾼다. */
export function delta(n: number, fmt: (abs: number) => string = (x) => String(Math.round(x)), goodWhenUp = true): string {
  if (Math.abs(n) < 0.05) return `<span class="delta flat">변화 없음</span>`;
  const up = n > 0;
  const tone = up === goodWhenUp ? 'good' : 'bad';
  return `<span class="delta ${tone}">${up ? '▲' : '▼'} ${fmt(Math.abs(n))}</span>`;
}

/** 작은 추세선. 값이 2개 미만이면 빈 칸을 돌려준다. */
export function sparkline(values: number[], label: string): string {
  if (values.length < 2) return `<span class="spark empty" aria-hidden="true"></span>`;
  const w = 100, h = 28, pad = 3;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - pad - ((v - min) / span) * (h - 2 * pad)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export type Grade = { cls: string; label: string };
/** 업무 적합도 등급. 적합도 1.0이 평균(능력치 50)이다. */
export function grade(stats: Stats, task: TaskId): Grade {
  const t = TASKS[task];
  const f = fit(stats, t.main, t.sub);
  if (f >= 1.3) return { cls: 'g3', label: '최적' };
  if (f >= 1.05) return { cls: 'g2', label: '적합' };
  if (f >= 0.85) return { cls: 'g1', label: '보통' };
  return { cls: 'g0', label: '미흡' };
}
export const gradeBadge = (g: Grade) => `<span class="grade ${g.cls}">${g.label}</span>`;

export function runwayText(months: number): string {
  return Number.isFinite(months) ? `${Math.floor(months)}개월` : '흑자';
}

export function traitChoice(state: GameState): string {
  const pend = state.player.pendingTraitChoice;
  if (!pend) return '';
  const node = TRAIT_TREE.find((t) => t.stat === pend.stat && t.threshold === pend.threshold)!;
  return `<section class="card highlight"><h2>특성 선택: ${STAT_LABEL[pend.stat]} ${pend.threshold}</h2>
    <div class="factions">${node.options.map((o) => `<button class="faction" data-act="trait" data-arg="${o.id}"><b>${o.name}</b><em>${o.desc}</em></button>`).join('')}</div></section>`;
}

export function noRevenueTask(co: NonNullable<GameState['company']>): boolean {
  const revenue: TaskId[] = ['marketing', 'sales'];
  return !revenue.includes(co.playerTask) && !co.employees.some((e) => revenue.includes(e.task)) && co.adBudget <= 0;
}
