export const STATS = ['leadership', 'dev', 'plan', 'sales', 'finance', 'ai'] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Record<Stat, number>;

export type TaskId = 'dev' | 'ai' | 'plan' | 'sales' | 'marketing' | 'hiring' | 'finance';
export type FactionId = 'north' | 'west' | 'south';
export type Intensity = 'normal' | 'crunch';

export type Activity =
  | { kind: 'study'; stat: Stat }
  | { kind: 'rest' }
  | { kind: 'side' }
  | { kind: 'network' };

export interface Avatar {
  name: string;
  stats: Stats; // 기본 능력치(성장 포함, 장비·HEU 제외)
  fatigue: number; // 0~100
  careerMonths: number;
  personalCash: number; // 개인 자금(게임 화폐)
  heuBalance: number; // 목업: 보유 HEU 수량
  exerciseDaysPerWeek: number[]; // 목업: 최근 4주 운동한 날 수
  linkedProfile: string | null; // 목업: 연동한 프로필 유형
  schedule: [Activity, Activity, Activity];
  forcedRest: boolean;
  traits: string[];
  pendingTraitChoice: { stat: Stat; threshold: number } | null;
  inventory: string[]; // 보유 장비 id
  equipped: string[]; // 착용 장비 id (최대 4)
  spentThisMonthUsd: number;
  monthlySpendLimitUsd: number;
}

export interface Employee {
  id: string;
  name: string;
  stats: Stats; // 진짜 능력치
  salary: number; // 월 급여
  satisfaction: number; // 0~100
  task: TaskId;
  hiredMonth: number;
}

export interface Range { lo: number; hi: number }

export interface Candidate {
  id: string;
  name: string;
  stats: Stats; // 숨겨진 진짜 능력치
  estimate: Record<Stat, Range>;
  ask: number; // 희망 월급
  interviewed: 'none' | 'live' | 'delegated';
  liveProbesLeft: number;
}

export interface Company {
  name: string;
  faction: FactionId;
  cash: number;
  product: number; // 제품 완성도 0~100
  users: number;
  enterpriseMrr: number; // 영업으로 쌓은 B2B 매출
  mrr: number;
  brand: number; // 0~100
  culture: number; // 0~100
  retentionBonus: number; // 기획 누적 효과(이탈률 감소)
  aiScore: number;
  irScore: number;
  intensity: Intensity;
  crunchMonths: number; // 크런치 누적(번아웃). 크런치 달 +1, 보통 달 -2
  adBudget: number; // 월 광고 예산(달러). 투자금을 성장으로 바꾸는 통로
  playerTask: TaskId;
  employees: Employee[];
  roundIndex: number; // 0: 없음, 1: 엔젤, 2: 시드, 3: 시리즈A, 4: 시리즈B
  ownership: number; // 플레이어 지분 0~1
  negativeCashMonths: number;
  history: { month: number; mrr: number; cash: number; valuation: number; users: number }[];
  /** 결단 카드가 남긴 몇 달짜리 효과(없던 옛 저장은 undefined) */
  buffs?: Buff[];
}

/** 몇 달 동안 이어지는 효과. task가 있으면 그 업무 성과에, workerId가 있으면 그 사람 성과에 mult를 곱한다. */
export interface Buff {
  label: string;
  monthsLeft: number;
  task?: TaskId | 'all';
  workerId?: string;
  mult?: number;
  churnAdd?: number;
  arpuMult?: number;
}

/** 참모 한 명의 조언 */
export interface Advice {
  who: string;
  /** 추천하는 선택지 번호(-1이면 의견 없음) */
  pick: number;
  text: string;
}

export interface DilemmaChoice {
  label: string;
  desc: string;
}

/** 이번 달 결단 카드. 화면에 쓸 글은 뽑을 때 만들어 저장한다. */
export interface DilemmaState {
  id: string;
  title: string;
  text: string;
  choices: DilemmaChoice[];
  /** 고르지 않고 정산하면 적용되는 선택지 */
  defaultChoice: number;
  params: Record<string, string | number>;
  advice: Advice[];
  chosen: number | null;
  result: string | null;
  tone: 'good' | 'bad' | 'info' | null;
}

export interface Rival {
  id: string;
  name: string;
  faction: FactionId;
  valuation: number;
  momentum: number;
}

export interface InvestmentOffer {
  round: number;
  investor: string;
  amount: number;
  preMoney: number;
  expiresMonth: number;
}

export interface MissionCard {
  id: string;
  stat: Stat;
  q: string;
  choices: string[];
  answer: number;
}

export interface MissionState {
  cardId: string;
  answered: boolean;
  correct: boolean;
}

export interface LogEntry { month: number; text: string; tone?: 'good' | 'bad' | 'info' }

export interface GameState {
  version: 1;
  seed: string;
  month: number; // 0부터 시작, SEASON_MONTHS에 도달하면 시즌 종료
  phase: 'create' | 'found' | 'play' | 'ended';
  endReason: 'season' | 'bankrupt' | null;
  player: Avatar;
  company: Company | null;
  candidates: Candidate[];
  rivals: Rival[];
  offers: InvestmentOffer[];
  mission: MissionState | null;
  reviewQueue: { cardId: string; dueMonth: number }[];
  monthsSeenCards: string[];
  lastEvent: { id: string; title: string; text: string } | null;
  log: LogEntry[];
  lastReport: MonthReport | null;
  /** 이번 달 결단 카드(없던 옛 저장은 undefined) */
  dilemma?: DilemmaState | null;
  /** 최근에 나온 결단 카드(반복 방지) */
  dilemmaSeen?: { id: string; month: number }[];
}

export interface MonthReport {
  month: number;
  outputs: { who: string; task: TaskId; output: number }[];
  revenue: number;
  costs: number;
  cashDelta: number;
  usersDelta: number;
  resigned: string[];
  growth: { stat: Stat; delta: number }[];
  fatigueAfter: number;
  event: string | null;
}
