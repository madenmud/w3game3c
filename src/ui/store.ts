// 화면에만 필요한 상태. 저장하지 않으며 새로 고치면 초기화된다.
import type { Stat, TaskId } from '../engine/types';

export interface TranscriptLine { stat: Stat; q: string; a: string; lo: number; hi: number }

export const ui = {
  /** 업무 배정 보드에서 고른 사람('player' 또는 직원 id) */
  selected: null as string | null,
  /** 면접실에 들어가 있는 후보 id */
  candidateId: null as string | null,
  /** 후보별 면접 대화 */
  transcript: {} as Record<string, TranscriptLine[]>,
  /** 후보별 작성 중인 제안 */
  offerDraft: {} as Record<string, { salary: number; task: TaskId }>,
};

export function resetUi() {
  ui.selected = null;
  ui.candidateId = null;
  ui.transcript = {};
  ui.offerDraft = {};
}
