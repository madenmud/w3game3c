import type { FactionId, Stat, TaskId, MissionCard } from './types';

export const SEASON_MONTHS = 56; // 실제 8주(하루 = 게임 1개월)
export const STAT_TOTAL = 270; // 새 아바타의 능력치 총합
export const STAT_MIN = 20;
export const STAT_MAX = 95;

export const STAT_LABEL: Record<Stat, string> = {
  leadership: '리더십',
  dev: '개발',
  plan: '기획',
  sales: '영업',
  finance: '재무·운영',
  ai: 'AI·지식',
};

export interface TaskDef {
  id: TaskId;
  label: string;
  main: Stat;
  sub: Stat;
  effect: string;
}

export const TASKS: Record<TaskId, TaskDef> = {
  dev: { id: 'dev', label: '제품 개발', main: 'dev', sub: 'plan', effect: '제품 완성도' },
  ai: { id: 'ai', label: 'AI 기능 개발', main: 'ai', sub: 'dev', effect: '완성도, 투자 매력도' },
  plan: { id: 'plan', label: '기획·디자인', main: 'plan', sub: 'sales', effect: '사용자 유지율' },
  sales: { id: 'sales', label: '영업·제휴', main: 'sales', sub: 'leadership', effect: 'B2B 매출' },
  marketing: { id: 'marketing', label: '마케팅', main: 'sales', sub: 'plan', effect: '사용자 수, 브랜드' },
  hiring: { id: 'hiring', label: '채용·조직관리', main: 'leadership', sub: 'finance', effect: '분위기, 면접 정확도' },
  finance: { id: 'finance', label: '재무·투자 준비', main: 'finance', sub: 'leadership', effect: '비용 절감, IR 점수' },
};
export const TASK_IDS = Object.keys(TASKS) as TaskId[];

export interface FactionDef {
  id: FactionId;
  name: string;
  tagline: string;
  perk: string;
  taskBonus: Partial<Record<TaskId, number>>;
}

// 진영 이름은 가칭이다.
export const FACTIONS: Record<FactionId, FactionDef> = {
  north: {
    id: 'north',
    name: '북방 인프라 그룹',
    tagline: '최대 자본의 클라우드·인프라 패권자',
    perk: '투자 라운드 밸류에이션 +15%, 개발 업무 +5%',
    taskBonus: { dev: 0.05 },
  },
  west: {
    id: 'west',
    name: '서방 오픈 연합',
    tagline: '자본은 적지만 명분과 커뮤니티의 오픈소스 진영',
    perk: '면접 제안 수락 기준 -10%, 만족도 하락 완화',
    taskBonus: { hiring: 0.05 },
  },
  south: {
    id: 'south',
    name: '남방 무역·핀테크 연합',
    tagline: '결제와 물류를 쥐고 실리로 움직이는 진영',
    perk: '영업·재무 업무 +5%',
    taskBonus: { sales: 0.05, finance: 0.05 },
  },
};
export const FACTION_IDS: FactionId[] = ['north', 'west', 'south'];

// 프로필 연동 목업: 실제 서비스에서는 GitHub·LinkedIn에서 거친 특징만 뽑아 능력치 '모양'을 정한다.
export const PROFILE_PRESETS: Record<string, { label: string; source: string; weights: Record<Stat, number> }> = {
  engineer: { label: '개발자형', source: 'GitHub', weights: { leadership: 0.8, dev: 1.6, plan: 0.9, sales: 0.6, finance: 0.6, ai: 1.5 } },
  product: { label: '기획자형', source: 'LinkedIn', weights: { leadership: 1.1, dev: 0.8, plan: 1.6, sales: 1.1, finance: 0.8, ai: 0.9 } },
  business: { label: '비즈니스형', source: 'LinkedIn', weights: { leadership: 1.3, dev: 0.5, plan: 1.0, sales: 1.6, finance: 1.3, ai: 0.6 } },
  balanced: { label: '균형형', source: '연동 없음', weights: { leadership: 1, dev: 1, plan: 1, sales: 1, finance: 1, ai: 1 } },
};

const FAMILY = ['한', '서', '윤', '강', '도', '류', '배', '하', '남궁', '진', '여', '모', '탁', '석', '구'];
const GIVEN = ['지안', '도윤', '서진', '하람', '이솔', '태오', '규리', '주원', '은재', '라온', '시우', '유나', '건', '다온', '세빈', '로아', '해찬', '민결', '예준', '아린'];
export const NAME_PARTS = { FAMILY, GIVEN };

export const COMPANY_NAME_PARTS = {
  a: ['노바', '퀀텀', '루프', '모멘텀', '피벗', '스택', '코어', '플럭스', '오빗', '스파크', '헬릭스', '블록'],
  b: ['랩스', '웍스', '테크', '다이나믹스', '시스템즈', '메이커스', '허브', '네트웍스'],
};

export const INVESTORS = ['북극성 벤처스', '바람개비 캐피탈', '단풍 파트너스', '모래시계 인베스트', '등대 벤처스', '은하 투자조합'];

export interface RoundDef { name: string; minMrr: number; minProduct: number; dilution: number; baseMultiple: number }
export const ROUNDS: RoundDef[] = [
  { name: '창업', minMrr: 0, minProduct: 0, dilution: 0, baseMultiple: 0 },
  { name: '엔젤', minMrr: 0, minProduct: 25, dilution: 0.1, baseMultiple: 0 },
  { name: '시드', minMrr: 3000, minProduct: 40, dilution: 0.15, baseMultiple: 0 },
  { name: '시리즈 A', minMrr: 20000, minProduct: 60, dilution: 0.2, baseMultiple: 0 },
  { name: '시리즈 B', minMrr: 70000, minProduct: 75, dilution: 0.2, baseMultiple: 0 },
];

export interface ItemDef { id: string; name: string; stat: Stat; bonus: number; priceUsd: number; kind: 'gear' | 'cosmetic' }
export const ITEMS: ItemDef[] = [
  { id: 'laptop-pro', name: '고성능 노트북', stat: 'dev', bonus: 4, priceUsd: 8, kind: 'gear' },
  { id: 'mech-keyboard', name: '기계식 키보드', stat: 'dev', bonus: 2, priceUsd: 3, kind: 'gear' },
  { id: 'gpu-credit', name: 'GPU 크레딧', stat: 'ai', bonus: 4, priceUsd: 8, kind: 'gear' },
  { id: 'paper-sub', name: '논문 구독', stat: 'ai', bonus: 2, priceUsd: 3, kind: 'gear' },
  { id: 'card-case', name: '가죽 명함 케이스', stat: 'sales', bonus: 3, priceUsd: 5, kind: 'gear' },
  { id: 'design-course', name: '디자인 강좌', stat: 'plan', bonus: 3, priceUsd: 5, kind: 'gear' },
  { id: 'excel-guide', name: '재무 모델링 가이드', stat: 'finance', bonus: 3, priceUsd: 5, kind: 'gear' },
  { id: 'coach', name: '리더십 코칭', stat: 'leadership', bonus: 5, priceUsd: 12, kind: 'gear' },
  { id: 'hoodie', name: '스타트업 후드티', stat: 'leadership', bonus: 0, priceUsd: 2, kind: 'cosmetic' },
];

export interface EventDef { id: string; title: string; text: string; faction: FactionId | null; task: TaskId | null; mult: number }
export const EVENTS: EventDef[] = [
  { id: 'ai-boom', title: 'AI 붐', text: '모든 회사의 AI 기능 개발 성과가 30% 오른다.', faction: null, task: 'ai', mult: 1.3 },
  { id: 'cloud-cut', title: '클라우드 요금 인하', text: '북방 인프라 그룹 제휴사의 개발 성과가 20% 오른다.', faction: 'north', task: 'dev', mult: 1.2 },
  { id: 'oss-festival', title: '오픈소스 축제', text: '서방 오픈 연합 제휴사의 채용·조직관리 성과가 30% 오른다.', faction: 'west', task: 'hiring', mult: 1.3 },
  { id: 'payment-reg', title: '결제 규제 강화', text: '남방 무역·핀테크 연합 제휴사의 영업 성과가 20% 줄어든다.', faction: 'south', task: 'sales', mult: 0.8 },
  { id: 'rate-hike', title: '금리 인상', text: '이번 달 모든 회사의 재무 업무 성과가 20% 오른다(비용 관리가 중요해짐).', faction: null, task: 'finance', mult: 1.2 },
  { id: 'viral', title: 'SNS 바이럴 시즌', text: '모든 회사의 마케팅 성과가 25% 오른다.', faction: null, task: 'marketing', mult: 1.25 },
  { id: 'quiet', title: '조용한 달', text: '특별한 사건이 없다.', faction: null, task: null, mult: 1 },
  { id: 'quiet2', title: '조용한 달', text: '특별한 사건이 없다.', faction: null, task: null, mult: 1 },
  { id: 'trade-expo', title: '무역 박람회', text: '남방 무역·핀테크 연합 제휴사의 영업 성과가 30% 오른다.', faction: 'south', task: 'sales', mult: 1.3 },
  { id: 'talent-war', title: '인재 전쟁', text: '북방 인프라 그룹이 인재를 쓸어 담는다. 북방 제휴사의 채용 성과가 20% 줄어든다.', faction: 'north', task: 'hiring', mult: 0.8 },
];

export const TRAIT_TREE: { stat: Stat; threshold: number; options: { id: string; name: string; desc: string }[] }[] = [
  { stat: 'dev', threshold: 75, options: [
    { id: 'architect', name: '설계자', desc: '회사 전체 개발 업무 성과 +5%' },
    { id: 'hacker', name: '해결사', desc: '내 미션 보너스 +20%p(개발 업무일 때)' },
  ] },
  { stat: 'sales', threshold: 75, options: [
    { id: 'closer', name: '클로저', desc: '내 영업 성과 +15%' },
    { id: 'storyteller', name: '이야기꾼', desc: '투자 밸류에이션 +10%' },
  ] },
  { stat: 'leadership', threshold: 75, options: [
    { id: 'captain', name: '주장', desc: '직원 만족도 매달 +1' },
    { id: 'scout', name: '스카우트', desc: '위임 면접 오차 절반' },
  ] },
  { stat: 'plan', threshold: 75, options: [
    { id: 'designer', name: '디자이너', desc: '기획 업무의 유지율 효과 +20%' },
    { id: 'pm', name: '오거나이저', desc: '피로 증가 -3/월' },
  ] },
  { stat: 'finance', threshold: 75, options: [
    { id: 'cfo', name: '살림꾼', desc: '월 고정비 -10%' },
    { id: 'dealmaker', name: '딜메이커', desc: '투자 제안 금액 +10%' },
  ] },
  { stat: 'ai', threshold: 75, options: [
    { id: 'researcher', name: '연구자', desc: 'AI 업무 성과 +10%' },
    { id: 'evangelist', name: '전도사', desc: 'AI 점수가 밸류에이션에 주는 효과 +50%' },
  ] },
];

export const MISSIONS: MissionCard[] = [
  { id: 'dev1', stat: 'dev', q: '배열에서 값을 찾는 이진 탐색의 시간 복잡도는?', choices: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], answer: 1 },
  { id: 'dev2', stat: 'dev', q: '`git rebase`와 `git merge`의 차이로 맞는 것은?', choices: ['rebase는 커밋 기록을 새로 쓴다', 'merge는 원격 저장소에만 쓴다', 'rebase는 브랜치를 삭제한다', '둘은 같다'], answer: 0 },
  { id: 'dev3', stat: 'dev', q: 'HTTP 상태 코드 404의 의미는?', choices: ['서버 오류', '권한 없음', '찾을 수 없음', '요청 성공'], answer: 2 },
  { id: 'dev4', stat: 'dev', q: '데이터베이스 인덱스를 추가하면 보통 어떻게 되나?', choices: ['읽기·쓰기 모두 빨라진다', '읽기는 빨라지고 쓰기는 조금 느려진다', '쓰기만 빨라진다', '변화 없다'], answer: 1 },
  { id: 'ai1', stat: 'ai', q: '모델이 학습 데이터에만 지나치게 맞춰진 상태를 무엇이라 하나?', choices: ['과소적합', '과적합', '정규화', '증강'], answer: 1 },
  { id: 'ai2', stat: 'ai', q: 'RAG(검색 증강 생성)의 주된 목적은?', choices: ['모델 크기를 줄인다', '외부 문서를 찾아 답변 근거로 쓴다', '학습 속도를 높인다', 'GPU를 아낀다'], answer: 1 },
  { id: 'ai3', stat: 'ai', q: '분류 모델에서 정밀도(precision)는?', choices: ['양성 예측 중 실제 양성 비율', '실제 양성 중 맞힌 비율', '전체 정답률', '음성 예측 비율'], answer: 0 },
  { id: 'ai4', stat: 'ai', q: '임베딩 벡터 간 유사도로 흔히 쓰는 것은?', choices: ['코사인 유사도', '해시 충돌', '정렬 안정성', '체크섬'], answer: 0 },
  { id: 'plan1', stat: 'plan', q: '최소 기능 제품(MVP)의 목적으로 가장 알맞은 것은?', choices: ['모든 기능을 완성한다', '가장 작은 비용으로 핵심 가설을 검증한다', '투자자에게만 보여준다', '디자인을 확정한다'], answer: 1 },
  { id: 'plan2', stat: 'plan', q: '같은 사용자 중 다음 주에도 돌아온 비율을 무엇이라 하나?', choices: ['전환율', '리텐션', '이탈 비용', 'ARPU'], answer: 1 },
  { id: 'plan3', stat: 'plan', q: 'A/B 테스트에서 먼저 정해야 하는 것은?', choices: ['색상', '측정할 지표와 가설', '서버 위치', '출시 날짜'], answer: 1 },
  { id: 'plan4', stat: 'plan', q: '사용자 인터뷰에서 피해야 할 질문은?', choices: ['최근에 이 문제를 겪은 적이 있나요?', '이 기능이 있으면 사시겠어요?', '그때 어떻게 해결했나요?', '얼마나 자주 겪나요?'], answer: 1 },
  { id: 'sales1', stat: 'sales', q: '고객 획득 비용(CAC)과 비교해 건강한 생애 가치(LTV)는 보통?', choices: ['CAC보다 낮다', 'CAC와 같다', 'CAC의 3배 이상', '상관없다'], answer: 2 },
  { id: 'sales2', stat: 'sales', q: 'B2B 영업에서 의사결정권자를 확인하는 단계는?', choices: ['리드 발굴', '자격 검증', '계약 갱신', '온보딩'], answer: 1 },
  { id: 'sales3', stat: 'sales', q: '가격을 올리기 전에 먼저 확인할 것은?', choices: ['경쟁사 로고', '고객이 느끼는 가치와 대안', '사무실 위치', '직원 수'], answer: 1 },
  { id: 'sales4', stat: 'sales', q: '깔때기(funnel)에서 가장 먼저 개선하면 효과가 큰 곳은?', choices: ['가장 많이 새는 단계', '가장 마지막 단계', '아무 데나', '가장 쉬운 단계'], answer: 0 },
  { id: 'fin1', stat: 'finance', q: '현금 6만 달러, 월 순소진 1만 달러면 런웨이는?', choices: ['3개월', '6개월', '10개월', '1년'], answer: 1 },
  { id: 'fin2', stat: 'finance', q: '프리머니 400만, 투자금 100만이면 투자자 지분은?', choices: ['20%', '25%', '10%', '40%'], answer: 0 },
  { id: 'fin3', stat: 'finance', q: 'MRR이 1만 달러면 ARR은?', choices: ['1만', '10만', '12만', '120만'], answer: 2 },
  { id: 'fin4', stat: 'finance', q: '매출총이익률을 구하는 식은?', choices: ['(매출-원가)/매출', '원가/매출', '매출/비용', '순이익/자산'], answer: 0 },
  { id: 'lead1', stat: 'leadership', q: '1:1 미팅에서 가장 중요한 것은?', choices: ['진척 보고만 받기', '팀원의 고민과 성장 이야기를 듣기', '짧게 끝내기', '업무 지시'], answer: 1 },
  { id: 'lead2', stat: 'leadership', q: '좋은 피드백 방식으로 알맞은 것은?', choices: ['성격을 지적한다', '구체적인 행동과 영향을 말한다', '모아서 연말에 한다', '공개적으로 한다'], answer: 1 },
  { id: 'lead3', stat: 'leadership', q: '위임할 때 반드시 함께 넘겨야 하는 것은?', choices: ['기대 결과와 권한', '내 일정', '회사 비밀번호', '없음'], answer: 0 },
  { id: 'lead4', stat: 'leadership', q: '팀 번아웃 신호로 보기 어려운 것은?', choices: ['잦은 실수', '회의 침묵', '자발적인 제안 증가', '병가 증가'], answer: 2 },
];

// 실시간 면접 질문 카드: 능력치마다 질문 1개와, 확인된 수준(낮음·보통·높음)에 따른 답변.
// 실제 서비스에서는 후보 플레이어가 직접 답한다. 체험판에서는 좁혀진 추정 범위에 맞는 답변을 보여 준다.
export const INTERVIEW_QA: Record<Stat, { q: string; answers: [string, string, string] }> = {
  leadership: {
    q: '팀원 둘이 일정 문제로 부딪혔을 때 어떻게 하셨나요?',
    answers: [
      '음, 보통은 두 분이 알아서 풀도록 기다리는 편이었어요.',
      '각자 이야기를 따로 듣고, 우선순위를 다시 정해서 조율했습니다.',
      '둘의 목표가 어디서 어긋났는지부터 같이 적어 봤어요. 일정 기준을 팀 규칙으로 만들어서 그 뒤로는 같은 일이 없었습니다.',
    ],
  },
  dev: {
    q: '최근에 가장 고생한 버그와 해결 과정을 들려주세요.',
    answers: [
      '검색해서 나온 방법을 이것저것 넣어 보다가 고쳐졌는데, 원인은 정확히 모르겠어요.',
      '로그를 좁혀 가며 재현 조건을 찾았고, 캐시 만료 처리 문제라 테스트를 붙여 고쳤습니다.',
      '간헐적 장애라 재현부터 자동화했어요. 락 순서가 원인이었고, 구조를 바꿔 같은 종류의 버그가 아예 못 생기게 했습니다.',
    ],
  },
  plan: {
    q: '기능을 빼자는 결정을 내린 적이 있나요? 근거는 무엇이었나요?',
    answers: [
      '기능은 많을수록 좋다고 생각해서, 뺀 적은 딱히 없습니다.',
      '사용률이 낮은 기능을 지표로 확인하고, 유지 비용과 비교해서 뺐습니다.',
      '핵심 사용 흐름을 가리는 기능을 실험으로 숨겨 봤더니 리텐션이 올랐어요. 그 결과로 팀을 설득해 정리했습니다.',
    ],
  },
  sales: {
    q: '거절한 고객을 다시 설득한 경험이 있나요?',
    answers: [
      '한 번 거절하시면 보통 다음 고객으로 넘어갔습니다.',
      '거절 이유를 다시 여쭤보고, 가격 조건을 조정해서 계약한 적이 있어요.',
      '거절 이유가 가격이 아니라 도입 부담이었어요. 2주 시범 운영을 제안했고, 지금은 가장 큰 고객입니다.',
    ],
  },
  finance: {
    q: '현금이 6개월치 남았다면 무엇부터 보시겠어요?',
    answers: [
      '일단 투자를 받으면 되지 않을까요?',
      '고정비 항목부터 정리하고, 매출 전망을 보수적으로 다시 잡겠습니다.',
      '주 단위 현금 흐름표를 먼저 만들고, 줄일 비용과 당길 매출, 투자 일정을 시나리오 세 개로 나눠 보겠습니다.',
    ],
  },
  ai: {
    q: '모델 답변이 틀릴 때 제품에서 어떻게 다루시겠어요?',
    answers: [
      '더 큰 모델로 바꾸면 해결되지 않을까 합니다.',
      '검색으로 근거 문서를 붙이고, 틀린 사례를 모아 평가 세트를 만들겠습니다.',
      '틀려도 되는 곳과 안 되는 곳을 먼저 나눕니다. 평가 세트로 회귀를 막고, 확신이 낮으면 사람 확인으로 넘기는 흐름을 넣겠습니다.',
    ],
  },
};
