// 업무 배정 보드: 업무마다 한 줄, 사람을 누르고 보낼 업무를 누른다. 누르기 전에 예상 성과를 보여 준다.
import { STAT_LABEL, TASKS, TASK_IDS } from '../../engine/data';
import * as G from '../../engine/game';
import { effectiveStats } from '../../engine/rules';
import { STATS, type GameState, type TaskId } from '../../engine/types';
import { bar, esc, grade, gradeBadge, money, r0 } from '../kit';
import { ui } from '../store';

/** 업무 한 줄의 성과 합이 지표에 주는 효과를 한 줄로 */
function laneEffect(t: TaskId, f: G.Forecast): string {
  const d = (a: number, b: number, digits = 1) => `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(digits)}`;
  switch (t) {
    case 'dev': case 'ai': return `완성도 ${d(f.before.product, f.after.product)}`;
    case 'plan': return '이탈률 감소';
    case 'sales': return 'B2B 매출 증가';
    case 'marketing': return `브랜드 ${d(f.before.brand, f.after.brand)}`;
    case 'hiring': return `분위기 ${d(f.before.culture, f.after.culture)}`;
    case 'finance': return '비용 절감, IR 점수';
  }
}

function renderSelected(state: GameState): string {
  const co = state.company!;
  const p = state.player;
  if (!ui.selected) return '';
  if (ui.selected === 'player') {
    const eff = effectiveStats(p);
    return `<section class="card highlight sel">
      <div class="row between"><h2>${esc(p.name)} <span class="hint-inline">오너 · 급여 없음</span></h2><button class="ghost small" data-act="select" data-arg="">닫기</button></div>
      <div class="mini-stats">${STATS.map((s) => `<span>${STAT_LABEL[s]} <b>${r0(eff[s])}</b>${eff[s] !== p.stats[s] ? `<i>(+${r0(eff[s] - p.stats[s])})</i>` : ''}</span>`).join('')}</div>
      <p class="hint">피로 ${r0(p.fatigue)} · 피로가 높으면 내 성과가 줄어요. 아래 보드에서 보낼 업무를 누르세요.</p>
    </section>`;
  }
  const e = co.employees.find((x) => x.id === ui.selected);
  if (!e) return '';
  return `<section class="card highlight sel">
    <div class="row between"><h2>${esc(e.name)} <span class="hint-inline">입사 ${state.month - e.hiredMonth}개월</span></h2><button class="ghost small" data-act="select" data-arg="">닫기</button></div>
    <div>만족도 ${bar(e.satisfaction, 100, e.satisfaction < 35 ? 'warn' : '')} <span class="num">${r0(e.satisfaction)}</span> <span class="hint-inline">성과 ×${(0.7 + 0.6 * e.satisfaction / 100).toFixed(2)}</span></div>
    <div class="mini-stats">${STATS.map((s) => `<span>${STAT_LABEL[s]} <b>${r0(e.stats[s])}</b></span>`).join('')}</div>
    <div class="row wrap-row">
      <label class="inline">월급 <input class="salary" data-input="salary" data-arg="${e.id}" type="number" step="50" min="${G.salaryFloor(e.stats)}" value="${e.salary}" /></label>
      <span class="hint-inline">시장가 ${money(G.askingSalary(e.stats))} · 하한 ${money(G.salaryFloor(e.stats))}</span>
      <button class="ghost small danger" data-act="fire" data-arg="${e.id}">내보내기</button>
    </div>
    <p class="hint">월급을 깎으면 만족도가 바로 떨어져요. 아래 보드에서 보낼 업무를 누르세요.</p>
  </section>`;
}

function renderBoard(state: GameState, f: G.Forecast): string {
  const co = state.company!;
  const workers = G.workersOf(state);
  const sel = workers.find((w) => w.id === ui.selected) ?? null;
  const preview = sel ? G.previewOutputs(state, sel.id) : null;
  const selEmployee = sel && !sel.isPlayer ? co.employees.find((e) => e.id === sel.id) : null;
  return `<section class="card board">
    <div class="row between"><h2>업무 배정</h2><span class="hint-inline">${sel ? `${esc(sel.who)} 님을 보낼 업무를 누르세요` : '사람을 누르면 업무별 예상 성과가 보여요'}</span></div>
    ${TASK_IDS.map((t) => {
      const here = workers.filter((w) => w.task === t);
      const raw = f.rawSum[t];
      const eff = f.sum[t];
      const crowded = raw > 10.05;
      const isCurrent = sel?.task === t;
      return `<div class="lane ${here.length ? '' : 'empty'} ${isCurrent ? 'current' : ''}">
        <div class="lane-head">
          <b>${TASKS[t].label}</b>
          <span class="hint-inline">${STAT_LABEL[TASKS[t].main]} 중심 · ${TASKS[t].effect}</span>
          <span class="lane-sum">${here.length ? `성과 <b>${eff.toFixed(1)}</b>${crowded ? ` <span class="warn-text" title="한 업무에 성과 합이 10을 넘으면 체감해요">몰림 -${r0((1 - eff / raw) * 100)}%</span>` : ''} · ${laneEffect(t, f)}` : '담당 없음'}</span>
        </div>
        <div class="chips-lane">
          ${here.map((w) => {
            const out = f.outputs.find((o) => o.id === w.id)?.output ?? 0;
            const emp = w.isPlayer ? null : co.employees.find((e) => e.id === w.id);
            const low = emp && emp.satisfaction < 40;
            return `<button class="who-chip ${ui.selected === w.id ? 'on' : ''}" data-act="select" data-arg="${w.id}" aria-pressed="${ui.selected === w.id}">
              <span class="nm">${esc(w.who)}${w.isPlayer ? ' (나)' : ''}</span>${gradeBadge(grade(w.stats, t))}<span class="num">${out.toFixed(1)}</span>${low ? '<span class="warn-text">불만</span>' : ''}
            </button>`;
          }).join('')}
          ${sel && preview && !isCurrent ? `<button class="assign" data-act="assign" data-arg="${t}">
              여기로 보내기 ${gradeBadge(grade(sel.stats, t))} 예상 <b>${preview[t].toFixed(1)}</b>
              <span class="hint-inline">${(preview[t] - preview[sel.task] >= 0 ? '+' : '') + (preview[t] - preview[sel.task]).toFixed(1)}${selEmployee ? ` · 만족도 ${G.likesTask(selEmployee.stats, t) ? '+2' : '-2'}/월` : ''}</span>
            </button>` : ''}
        </div>
      </div>`;
    }).join('')}
    <p class="hint">등급은 업무 적합도예요(능력치 50이 '보통'). 직원은 자기 능력치 상위 2개를 쓰는 업무를 맡으면 만족도가 매달 +2, 아니면 -2예요. 한 업무의 성과 합이 10을 넘으면 넘는 만큼 체감해요.</p>
  </section>`;
}

export function renderTeam(state: GameState): string {
  const co = state.company!;
  const f = G.forecast(state)!;
  return `
  <section class="card">
    <h2>이 배정으로 한 달 뒤 <span class="hint-inline">예상 · 개인 성과는 ±15% 흔들려요</span></h2>
    <div class="fc">
      <div><span class="k">완성도</span><b>${r0(f.before.product)} → ${f.after.product.toFixed(1)}</b></div>
      <div><span class="k">사용자</span><b>${f.usersDelta >= 0 ? '+' : ''}${f.usersDelta.toLocaleString()}</b></div>
      <div><span class="k">MRR</span><b>${money(f.before.mrr)} → ${money(f.after.mrr)}</b></div>
      <div><span class="k">비용</span><b>${money(f.costs)}</b></div>
      <div><span class="k">현금</span><b class="${f.cashDelta < 0 ? 'bad' : 'good'}">${f.cashDelta >= 0 ? '+' : '-'}${money(Math.abs(f.cashDelta))}</b></div>
    </div>
  </section>
  ${renderSelected(state)}
  ${renderBoard(state, f)}
  ${co.employees.length ? '' : '<section class="card"><p class="hint">아직 직원이 없어요. 채용 탭에서 후보를 만나 보세요.</p></section>'}
  <section class="card">
    <h2>근무 강도</h2>
    <div class="chips">
      <button class="chip ${co.intensity === 'normal' ? 'on' : ''}" data-act="intensity" data-arg="normal">보통</button>
      <button class="chip ${co.intensity === 'crunch' ? 'on' : ''}" data-act="intensity" data-arg="crunch">크런치</button>
    </div>
    <p class="hint">크런치는 처음 ${G.CRUNCH_GRACE_MONTHS}개월 동안 성과 +20%예요. 더 이어지면 번아웃으로 성과 보너스가 매달 줄고(최저 -20%) 만족도와 분위기가 더 빨리 떨어져요. 보통으로 돌아오면 번아웃이 매달 2씩 풀려요.</p>
    ${co.crunchMonths > G.CRUNCH_GRACE_MONTHS ? `<p class="bad">번아웃 ${co.crunchMonths - G.CRUNCH_GRACE_MONTHS}단계 · 다음 달도 크런치면 성과 ×${G.crunchOutputMult(co.crunchMonths + 1).toFixed(1)}</p>` : co.crunchMonths > 0 ? `<p class="hint">크런치 누적 ${co.crunchMonths}개월</p>` : ''}
  </section>
  <section class="card">
    <h2>광고 예산</h2>
    <p class="hint">매달 이 금액을 써서 사용자를 사요. 예산이 클수록 1명당 단가가 올라요. 현금이 모자라면 남은 현금만큼만 써요.</p>
    <label class="inline">월 광고 예산(달러) <input data-input="ad-budget" type="number" min="0" max="${G.AD_BUDGET_MAX}" step="500" value="${co.adBudget}" /></label>
    <span class="hint-inline">예상 신규 사용자 약 ${Math.round(G.adUsers(co.adBudget, co.product)).toLocaleString()}명/월</span>
  </section>`;
}
