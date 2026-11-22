// 채용: 후보 목록 → 면접실(질문 카드로 범위를 좁히고 제안을 보낸다)
import { INTERVIEW_QA, STAT_LABEL, TASKS, TASK_IDS } from '../../engine/data';
import * as G from '../../engine/game';
import { STATS, type Candidate, type GameState, type Stat, type Stats, type TaskId } from '../../engine/types';
import { esc, money, runwayText } from '../kit';
import { ui } from '../store';

function rangeCell(lo: number, hi: number): string {
  return `<span class="range"><span class="rbar" style="left:${lo}%;width:${Math.max(2, hi - lo)}%"></span></span><span class="num small">${lo}~${hi}</span>`;
}

function midStats(c: Candidate): Stats {
  const o = {} as Stats;
  for (const s of STATS) o[s] = (c.estimate[s].lo + c.estimate[s].hi) / 2;
  return o;
}

const width = (c: Candidate, s: Stat) => c.estimate[s].hi - c.estimate[s].lo;
const STATUS: Record<Candidate['interviewed'], string> = { none: '면접 전', live: '실시간 면접함', delegated: '위임 면접함' };

/** 제안 초안. 처음에는 희망 월급과, 추정치로 본 가장 맞는 업무다. */
export function draftFor(c: Candidate): { salary: number; task: TaskId } {
  return (ui.offerDraft[c.id] ??= { salary: c.ask, task: G.bestTaskFor(midStats(c)) });
}

/** 질문에 대한 답변: 좁혀진 범위의 가운데 값에 맞는 수준 */
export function answerFor(stat: Stat, lo: number, hi: number): string {
  const mid = (lo + hi) / 2;
  return INTERVIEW_QA[stat].answers[mid < 45 ? 0 : mid < 65 ? 1 : 2];
}

function renderList(state: GameState): string {
  const err = G.delegatedInterviewError(state);
  const co = state.company!;
  return `
  <section class="card">
    <h2>후보 ${state.candidates.length}명 <span class="hint-inline">직원 ${co.employees.length}/${G.MAX_EMPLOYEES}</span></h2>
    <p class="hint">진짜 능력치는 숨겨져 있고 추정 범위만 보여요. 면접실에서 질문 카드 3장으로 궁금한 능력치를 ±3까지 좁히거나, 위임 면접으로 전체를 ±${err}까지 좁힐 수 있어요. 후보는 3개월마다 바뀌어요.</p>
  </section>
  ${state.candidates.length ? state.candidates.map((c) => {
    const mid = midStats(c);
    const top = [...STATS].sort((a, b) => mid[b] - mid[a]).slice(0, 2);
    return `<section class="card cand">
      <div class="row between"><b>${esc(c.name)}</b><span class="hint-inline">희망 월급 ${money(c.ask)}</span></div>
      <div class="row wrap-row">
        ${top.map((s) => `<span class="pill">${STAT_LABEL[s]} ${c.estimate[s].lo}~${c.estimate[s].hi}</span>`).join('')}
        <span class="pill muted">${STATUS[c.interviewed]}</span>
      </div>
      <div class="row between wrap-row">
        <span class="hint-inline">어울리는 업무: ${TASKS[G.bestTaskFor(mid)].label}</span>
        <button class="primary small" data-act="open-cand" data-arg="${c.id}">면접실 들어가기</button>
      </div>
    </section>`;
  }).join('') : '<section class="card"><p>지금은 후보가 없어요. 3개월마다 새 후보가 오고, 네트워킹을 하면 더 와요.</p></section>'}`;
}

function renderRoom(state: GameState, c: Candidate): string {
  const co = state.company!;
  const err = G.delegatedInterviewError(state);
  const lines = ui.transcript[c.id] ?? [];
  const draft = draftFor(c);
  const range = G.candidateOutputRange(state, c, draft.task);
  const runway = G.runwayWithExtraCost(co, draft.salary + 200);
  const full = co.employees.length >= G.MAX_EMPLOYEES;
  return `
  <section class="card">
    <div class="row between"><button class="ghost small" data-act="open-cand" data-arg="">← 후보 목록</button><span class="pill muted">${STATUS[c.interviewed]}</span></div>
    <h2 class="room-title">${esc(c.name)} <span class="hint-inline">희망 월급 ${money(c.ask)}</span></h2>
    <div class="cand-stats">${STATS.map((s) => `<div class="cs ${width(c, s) <= 6 ? 'known' : ''}"><span class="stat-name">${STAT_LABEL[s]}</span>${rangeCell(c.estimate[s].lo, c.estimate[s].hi)}</div>`).join('')}</div>
    <p class="hint">막대가 좁을수록 확실해요. 굵게 표시된 능력치는 질문으로 확인한 값이에요.</p>
  </section>
  <section class="card">
    <h2>실시간 면접 <span class="hint-inline">질문 카드 ${c.liveProbesLeft}장 남음</span></h2>
    <div class="chat" aria-live="polite">
      ${lines.length ? lines.map((l) => `
        <div class="bubble me"><span class="tagline">${STAT_LABEL[l.stat]} 질문</span>${esc(l.q)}</div>
        <div class="bubble them">${esc(l.a)}<span class="tagline">${STAT_LABEL[l.stat]} ${l.lo}~${l.hi}로 좁혀졌어요</span></div>`).join('')
        : `<p class="hint">확인하고 싶은 능력치의 질문 카드를 골라 보세요. 실제 서비스에서는 후보 플레이어가 직접 답해요.</p>`}
    </div>
    ${c.liveProbesLeft > 0 ? `<div class="qcards">${STATS.map((s) => `
      <button class="qcard" data-act="probe" data-arg="${c.id}|${s}" ${width(c, s) <= 6 ? 'disabled' : ''}>
        <span class="tagline">${STAT_LABEL[s]} · 지금 ${c.estimate[s].lo}~${c.estimate[s].hi}</span>${esc(INTERVIEW_QA[s].q)}
      </button>`).join('')}</div>` : `<p class="hint">질문 카드를 모두 썼어요.</p>`}
    <div class="row wrap-row">
      <button class="small" data-act="delegate" data-arg="${c.id}" ${c.interviewed === 'delegated' ? 'disabled' : ''}>위임 면접 맡기기</button>
      <span class="hint-inline">채용 담당이 나머지 능력치를 ±${err}까지 좁혀요. 질문 카드와 함께 쓸 수 있어요.</span>
    </div>
  </section>
  <section class="card highlight">
    <h2>제안서</h2>
    <div class="row wrap-row">
      <label class="inline">월급 <input data-input="offer-salary" data-arg="${c.id}" type="number" step="50" min="0" value="${draft.salary}" /></label>
      <label class="inline">맡길 업무 <select data-input="offer-task" data-arg="${c.id}">${TASK_IDS.map((t) => `<option value="${t}" ${t === draft.task ? 'selected' : ''}>${TASKS[t].label}</option>`).join('')}</select></label>
    </div>
    <div class="fc">
      <div><span class="k">예상 월 성과</span><b>${range.lo.toFixed(1)} ~ ${range.hi.toFixed(1)}</b></div>
      <div><span class="k">채용 후 런웨이</span><b class="${runway < 6 ? 'bad' : ''}">${runwayText(runway)}</b></div>
      <div><span class="k">희망 대비</span><b>${draft.salary >= c.ask ? '+' : '-'}${money(Math.abs(draft.salary - c.ask))}</b></div>
    </div>
    <p class="hint">${draft.salary >= c.ask ? '희망 월급 이상이라 수락할 거예요. 더 주면 입사 때 만족도가 높아요.' : '희망보다 낮아요. 브랜드가 높으면 조금 낮아도 받지만, 거절하면 후보는 떠나요.'}</p>
    <div class="row"><button class="primary" data-act="offer" data-arg="${c.id}" ${full ? 'disabled' : ''}>제안 보내기</button>${full ? `<span class="hint-inline">직원이 가득 찼어요(${G.MAX_EMPLOYEES}명)</span>` : ''}</div>
  </section>`;
}

export function renderHire(state: GameState): string {
  const c = state.candidates.find((x) => x.id === ui.candidateId);
  if (!c) { ui.candidateId = null; return renderList(state); }
  return renderRoom(state, c);
}
