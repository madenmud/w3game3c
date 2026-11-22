// 현황 대시보드: 오늘 할 일 → 핵심 지표와 추세 → 다음 달 예상 → 학습 카드 → 지난달 정산
import { MISSIONS, ROUNDS, STAT_LABEL, TASKS } from '../../engine/data';
import { DILEMMA_COOLDOWN } from '../../engine/dilemmas';
import * as G from '../../engine/game';
import type { GameState } from '../../engine/types';
import { bar, delta, esc, money, noRevenueTask, r0, runwayText, sparkline, traitChoice } from '../kit';

type Todo = { text: string; act: string; arg: string; cta: string };

function todos(state: GameState): Todo[] {
  const co = state.company!;
  const out: Todo[] = [];
  if (state.dilemma && state.dilemma.chosen === null) out.push({ text: `이번 달 결단: ${state.dilemma.title}`, act: 'goto', arg: 'dilemma', cta: '결정' });
  if (state.mission && !state.mission.answered) out.push({ text: '오늘의 학습 카드를 풀면 이번 달 성과가 올라요', act: 'goto', arg: 'mission', cta: '풀기' });
  if (state.player.pendingTraitChoice) out.push({ text: '새 특성을 고를 수 있어요', act: 'goto', arg: 'trait', cta: '고르기' });
  if (state.offers.length) out.push({ text: `투자 제안 ${state.offers.length}건이 기다리고 있어요`, act: 'tab', arg: 'invest', cta: '검토' });
  if (noRevenueTask(co)) out.push({ text: '매출을 만드는 사람이 없어요(마케팅·영업·광고)', act: 'tab', arg: 'team', cta: '배정' });
  const unhappy = co.employees.filter((e) => e.satisfaction < 40).length;
  if (unhappy) out.push({ text: `만족도가 낮은 직원이 ${unhappy}명 있어요`, act: 'tab', arg: 'team', cta: '살펴보기' });
  const fresh = state.candidates.filter((c) => c.interviewed === 'none').length;
  if (fresh && co.employees.length < G.MAX_EMPLOYEES) out.push({ text: `아직 면접하지 않은 후보가 ${fresh}명 있어요`, act: 'tab', arg: 'hire', cta: '면접' });
  return out;
}

function kpi(label: string, value: string, sub: string, spark: string, tone = ''): string {
  return `<div class="kpi ${tone}"><span class="k">${label}</span><span class="v">${value}</span><span class="s">${sub}</span>${spark}</div>`;
}

function renderKpis(state: GameState): string {
  const co = state.company!;
  const h = co.history.slice(-12);
  const last = h[h.length - 1];
  const prev = h[h.length - 2];
  const rep = state.lastReport;
  const val = G.valuation(co, state.player.traits);
  const none = `<span class="delta flat">첫 달</span>`;
  const usd = (x: number) => money(x);
  const num = (x: number) => Math.round(x).toLocaleString();
  return `<section class="kpis" aria-label="핵심 지표">
    ${kpi('현금', money(co.cash), `${rep ? delta(rep.cashDelta, usd) : none} · 런웨이 ${runwayText(G.runwayMonths(co))}`, sparkline(h.map((x) => x.cash), '현금 추이'), co.cash < 0 ? 'neg' : '')}
    ${kpi('월 매출(MRR)', money(co.mrr), last ? delta(last.mrr - (prev?.mrr ?? 0), usd) : none, sparkline(h.map((x) => x.mrr), 'MRR 추이'))}
    ${kpi('사용자', co.users.toLocaleString(), rep ? delta(rep.usersDelta, num) : none, sparkline(h.map((x) => x.users), '사용자 추이'))}
    ${kpi('회사 가치', money(val), last && prev ? delta(last.valuation - prev.valuation, usd) : none, sparkline(h.map((x) => x.valuation), '회사 가치 추이'))}
  </section>`;
}

function renderForecast(state: GameState): string {
  const f = G.forecast(state);
  if (!f) return '';
  const co = state.company!;
  const cashAfter = f.after.cash;
  return `<section class="card">
    <h2>다음 정산 예상 <span class="hint-inline">지금 배정 그대로일 때</span></h2>
    <div class="fc">
      <div><span class="k">매출</span><b>${money(f.revenue)}</b></div>
      <div><span class="k">비용</span><b>${money(f.costs)}</b></div>
      <div><span class="k">현금</span><b class="${f.cashDelta < 0 ? 'bad' : 'good'}">${f.cashDelta >= 0 ? '+' : '-'}${money(Math.abs(f.cashDelta))}</b></div>
      <div><span class="k">사용자</span><b>${f.usersDelta >= 0 ? '+' : ''}${f.usersDelta.toLocaleString()}</b></div>
      <div><span class="k">완성도</span><b>${r0(f.before.product)} → ${f.after.product.toFixed(1)}</b></div>
    </div>
    ${renderBuffs(state)}
    <p class="hint">개인 성과는 매달 ±15% 흔들리고, 정산 뒤 현금은 약 ${money(cashAfter)}이 돼요.${cashAfter < 0 && co.cash >= 0 ? ' <b class="bad">이대로면 현금이 바닥나요.</b>' : ''} 배정을 바꾸면 이 숫자가 바로 바뀌어요.</p>
    <div class="row"><button class="small" data-act="tab" data-arg="team">업무 배정 바꾸기</button></div>
  </section>`;
}

function renderDilemma(state: GameState): string {
  const d = state.dilemma;
  if (!d) return '';
  const votes = d.choices.map((_, i) => d.advice.filter((a) => a.pick === i).length);
  const decided = d.chosen !== null;
  const advice = d.advice.length
    ? `<ul class="advice">${d.advice.map((a) => `<li><b>${esc(a.who)}</b>${a.pick >= 0 ? ` <span class="pick">→ ${esc(d.choices[a.pick]!.label)}</span>` : ''}<span class="say">“${esc(a.text)}”</span></li>`).join('')}</ul>`
    : `<p class="hint">조언해 줄 직원이 없어요. 사람을 뽑으면 성향이 다른 참모들이 의견을 내요.</p>`;
  return `<section class="card dilemma ${decided ? 'done' : ''}" id="dilemma">
    <h2>이번 달 결단 <span class="hint-inline">${esc(d.title)}</span></h2>
    <p class="story">${esc(d.text)}</p>
    <h3>참모 조언</h3>
    ${advice}
    <div class="dchoices">${d.choices.map((c, i) => `
      <button class="dchoice ${d.chosen === i ? 'on' : ''}" data-act="dilemma" data-arg="${i}" ${decided ? 'disabled' : ''}>
        <span class="l">${esc(c.label)}${votes[i] ? ` <span class="tag">추천 ${votes[i]}</span>` : ''}</span>
        <span class="d">${esc(c.desc)}</span>
      </button>`).join('')}</div>
    ${decided
      ? `<p class="${d.tone === 'bad' ? 'bad' : d.tone === 'good' ? 'good' : ''}"><b>결과</b> ${esc(d.result ?? '')}</p>`
      : `<p class="hint">고르지 않고 정산하면 '${esc(d.choices[d.defaultChoice]!.label)}'(으)로 처리돼요. 같은 일은 ${DILEMMA_COOLDOWN}개월 안에 다시 일어나지 않아요.</p>`}
  </section>`;
}

function renderBuffs(state: GameState): string {
  const b = state.company!.buffs ?? [];
  if (!b.length) return '';
  return `<p class="hint">진행 중인 효과: ${b.map((x) => `${esc(x.label)} (${x.monthsLeft}개월 남음)`).join(', ')}</p>`;
}

function renderMission(state: GameState): string {
  const card = state.mission ? MISSIONS.find((m) => m.id === state.mission!.cardId) : null;
  return `<section class="card" id="mission">
    <h2>오늘의 학습 카드 <span class="hint-inline">맞히면 이번 달 내 성과 +20%, 팀 성과 +10%, 성장 효율 +20%</span></h2>
    ${card ? `<p class="q">${esc(card.q)}</p>
      <div class="choices">${card.choices.map((c, i) => {
        const m = state.mission!;
        const cls = m.answered ? (i === card.answer ? 'right' : '') : '';
        return `<button class="choice ${cls}" data-act="answer" data-arg="${i}" ${m.answered ? 'disabled' : ''}>${esc(c)}</button>`;
      }).join('')}</div>
      ${state.mission!.answered ? `<p class="${state.mission!.correct ? 'good' : 'bad'}">${state.mission!.correct ? '정답! 이번 달 보너스가 적용돼요.' : '오답이에요. 2개월 뒤에 다시 나와요.'}</p>` : ''}` : '<p>카드 없음</p>'}
  </section>`;
}

function renderReport(state: GameState): string {
  const rep = state.lastReport;
  if (!rep) {
    return `<section class="card"><h2>시작 가이드</h2><ol class="guide">
      <li>'채용'에서 후보를 면접하고 제안을 보내세요.</li>
      <li>'팀·업무'에서 나와 직원에게 업무를 배정하세요.</li>
      <li>'성장'에서 이번 달 개인 스케줄 3칸을 정하세요.</li>
      <li>학습 카드를 풀고, 아래 버튼으로 한 달을 진행하세요.</li>
    </ol></section>`;
  }
  const max = Math.max(...rep.outputs.map((o) => o.output), 1);
  return `<section class="card">
    <h2>지난달 정산</h2>
    <p>매출 ${money(rep.revenue)} · 비용 ${money(rep.costs)} · 현금 ${rep.cashDelta >= 0 ? '+' : ''}${money(rep.cashDelta)} · 사용자 ${rep.usersDelta >= 0 ? '+' : ''}${rep.usersDelta.toLocaleString()}</p>
    <div class="outs">${rep.outputs.map((o) => `
      <div class="out"><span class="who">${esc(o.who)}</span><span class="task">${TASKS[o.task].label}</span>${bar(o.output, max)}<span class="num">${o.output.toFixed(1)}</span></div>`).join('')}
    </div>
    ${rep.growth.length ? `<p>성장: ${rep.growth.map((g) => `${STAT_LABEL[g.stat]} +${g.delta.toFixed(2)}`).join(', ')}</p>` : ''}
    ${rep.resigned.length ? `<p class="bad">퇴사: ${rep.resigned.map(esc).join(', ')}</p>` : ''}
  </section>`;
}

export function renderHome(state: GameState): string {
  const co = state.company!;
  const p = state.player;
  const runway = G.runwayMonths(co);
  const list = todos(state);
  return `
  ${runway < 4 ? `<section class="card warn-card"><b>현금이 ${Math.floor(runway)}개월치 남았어요.</b> 매출은 마케팅(사용자)과 영업(B2B)에서 나와요. 투자 탭의 다음 라운드 조건을 확인하거나, 비용을 줄이세요.</section>` : ''}
  <section class="card todo">
    <h2>오늘 할 일</h2>
    ${list.length ? `<ul>${list.map((t) => `<li><span>${esc(t.text)}</span><button class="small" data-act="${t.act}" data-arg="${t.arg}">${t.cta}</button></li>`).join('')}</ul>`
      : `<p class="good">할 일을 마쳤어요. 아래 버튼으로 한 달을 진행하세요.</p>`}
  </section>
  ${renderDilemma(state)}
  ${renderKpis(state)}
  ${renderForecast(state)}
  <div id="trait">${traitChoice(state)}</div>
  ${renderMission(state)}
  <section class="card grid2">
    <div><h3>제품 완성도</h3>${bar(co.product)} <span class="num">${r0(co.product)}</span></div>
    <div><h3>브랜드</h3>${bar(co.brand)} <span class="num">${r0(co.brand)}</span></div>
    <div><h3>조직 분위기</h3>${bar(co.culture)} <span class="num">${r0(co.culture)}</span></div>
    <div><h3>내 피로</h3>${bar(p.fatigue, 100, p.fatigue > 60 ? 'warn' : '')} <span class="num">${r0(p.fatigue)}</span></div>
    <div><h3>지분</h3><span class="big-num">${(co.ownership * 100).toFixed(1)}%</span> <span class="hint-inline">${ROUNDS[co.roundIndex]!.name}</span></div>
    <div><h3>직원</h3><span class="big-num">${co.employees.length}</span> <span class="hint-inline">/ ${G.MAX_EMPLOYEES}명</span></div>
  </section>
  ${renderReport(state)}`;
}
