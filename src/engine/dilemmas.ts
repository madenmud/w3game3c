// 이번 달 결단 카드와 참모 조언.
// 레퍼런스: 삼국지 시리즈의 군의·진언(참모마다 다른 의견과 성공률), Reigns의 대가 있는 양자택일,
// Sid Meier의 "흥미로운 결정"(정답이 상황마다 달라야 한다).
// 카드는 매달 초(1개월차부터) 회사 상황에 맞는 것 하나가 나오고, 고르지 않고 정산하면 기본 선택지가 적용된다.
import { FACTIONS, STAT_LABEL } from './data';
import { askingSalary, fmtMoney, MAX_EMPLOYEES, pushLog, statTotal } from './game';
import { clamp, intBetween, pick, rngFor, uniform, type Rng } from './rng';
import { effectiveStats } from './rules';
import { STATS, type Advice, type Buff, type Candidate, type DilemmaState, type Employee, type GameState, type Range, type Stat } from './types';

/** 같은 카드가 다시 나오기까지 최소 개월 수 */
export const DILEMMA_COOLDOWN = 10;
/** 조언하는 참모 수 */
export const MAX_ADVISORS = 3;
/** 만족도가 이보다 낮은 직원은 조언하지 않는다 */
export const ADVICE_MIN_SATISFACTION = 35;

interface ChoiceDef {
  label: string;
  desc: string;
  /** 이 능력치가 높은 참모가 이 선택을 좋아한다 */
  lens: Stat;
  /** 참모가 말하는 이유 */
  why: string;
  /** 성공 확률이 있는 선택이면 진짜 확률(참모는 능력치만큼 정확하게 말한다) */
  odds?: number;
}

interface Made {
  title: string;
  text: string;
  choices: ChoiceDef[];
  defaultChoice: number;
  params: Record<string, string | number>;
  /** 조언할 때 보는 능력치(확률 추정 정확도) */
  domain: Stat;
  /** 조언에서 빼는 사람(카드의 당사자) */
  exclude?: string;
}

type Out = { text: string; tone: 'good' | 'bad' | 'info' };

interface DilemmaDef {
  id: string;
  weight: number;
  when: (s: GameState) => boolean;
  make: (s: GameState, rng: Rng) => Made | null;
  resolve: (s: GameState, choice: number, p: Record<string, string | number>, rng: Rng) => Out;
}

const round50 = (x: number) => Math.round(x / 50) * 50;
const round100 = (x: number) => Math.round(x / 100) * 100;
const monthlyCost = (s: GameState) => {
  const co = s.company!;
  return co.employees.reduce((a, e) => a + e.salary, 0) + 1000 + 200 * co.employees.length;
};
const emp = (s: GameState, id: string | number) => s.company!.employees.find((e) => e.id === String(id));
const rival = (s: GameState, id: string | number) => s.rivals.find((r) => r.id === String(id));
const addBuff = (s: GameState, b: Buff) => { (s.company!.buffs ??= []).push(b); };

function bestEmployee(s: GameState): Employee | undefined {
  return [...s.company!.employees].sort((a, b) => statTotal(b.stats) - statTotal(a.stats))[0];
}

/** 경쟁사 에이스: 숨은 능력치가 높은 후보. 우리가 정확히 알고 있다(이미 소문이 난 사람). */
function aceCandidate(rng: Rng, id: string, name: string): Candidate {
  const total = intBetween(rng, 320, 370);
  const peaks = [pick(rng, STATS), pick(rng, STATS)];
  const raw = STATS.map((st) => (peaks.includes(st) ? 1.6 : 0.8) + rng() * 0.2);
  const sum = raw.reduce((a, b) => a + b, 0);
  const stats = {} as Record<Stat, number>;
  STATS.forEach((st, i) => { stats[st] = clamp(Math.round((raw[i]! / sum) * total), 20, 95); });
  const estimate = {} as Record<Stat, Range>;
  for (const st of STATS) estimate[st] = { lo: clamp(stats[st] - 3, 0, 100), hi: clamp(stats[st] + 3, 0, 100) };
  return { id, name, stats, estimate, ask: round50(askingSalary(stats) * 1.4), interviewed: 'delegated', liveProbesLeft: 0 };
}

export const DILEMMAS: DilemmaDef[] = [
  {
    id: 'cofounder',
    weight: 3,
    when: (s) => s.month <= 6 && s.company!.employees.length === 0,
    make: (s, rng) => {
      const peer = aceCandidate(rng, `ace-cofounder-${s.month}`, `${pick(rng, ['오랜 친구', '대학 동기', '전 직장 동료'])} ${pick(rng, ['은호', '다인', '시우', '나래'])}`);
      // 공동창업자: 에이스보다는 조금 낮지만 월급은 시장가의 절반만 받는다
      for (const st of STATS) peer.stats[st] = Math.max(20, peer.stats[st] - 10);
      const salary = round50(askingSalary(peer.stats) * 0.5);
      const top = [...STATS].sort((a, b) => peer.stats[b] - peer.stats[a]).slice(0, 2).map((x) => STAT_LABEL[x]).join('·');
      return {
        title: '공동창업 제안',
        text: `${peer.name} 님이 "나도 같이 하자"며 찾아왔다. ${top}에 강하다. 월급은 반만 받겠다고 한다. 대신 지분을 원한다.`,
        choices: [
          { label: '지분 15% 주고 함께한다', desc: `내 지분 -15%. ${peer.name} 님이 월급 ${fmtMoney(salary)}로 합류해요(시장가의 절반).`, lens: 'leadership', why: '혼자서는 멀리 못 가요. 믿을 사람이 필요해요.' },
          { label: '지분 5%에 직원으로 제안', desc: '내 지분 -5%. 60% 확률로 받아들이고, 아니면 떠나요.', lens: 'finance', why: '지분은 회사의 전부예요. 아껴서 나눠야 해요.', odds: 0.6 },
          { label: '혼자 간다', desc: '아무 일도 없어요.', lens: 'dev', why: '아직은 혼자서도 충분해요.' },
        ],
        defaultChoice: 2,
        params: { salary, stats: JSON.stringify(peer.stats), name: peer.name, id: peer.id, odds: 0.6 },
        domain: 'leadership',
      };
    },
    resolve: (s, c, p, rng) => {
      const co = s.company!;
      if (c === 2) return { text: '혼자 가기로 했다.', tone: 'info' };
      if (c === 1 && rng() >= Number(p.odds)) return { text: `${p.name} 님이 "그 정도면 안 할래"라며 돌아갔다.`, tone: 'bad' };
      co.ownership *= c === 0 ? 0.85 : 0.95;
      const stats = JSON.parse(String(p.stats));
      co.employees.push({ id: String(p.id), name: String(p.name), stats, salary: Number(p.salary), satisfaction: c === 0 ? 85 : 65, task: 'sales', hiredMonth: s.month });
      return { text: `${p.name} 님이 합류했다(영업·제휴 배정). 팀·업무 탭에서 업무를 바꿀 수 있다.`, tone: 'good' };
    },
  },
  {
    id: 'first-customer',
    weight: 3,
    when: (s) => s.month <= 10 && s.company!.users < 1500,
    make: () => ({
      title: '첫 단골의 요구',
      text: '초기부터 써 온 열성 사용자 모임이 "기능 몇 개만 더 있으면 친구들한테 다 소개하겠다"고 한다. 대신 그동안은 무료로 써야겠다고.',
      choices: [
        { label: '무료로 맞춰 준다', desc: '사용자 +200, 브랜드 +3. 3개월 동안 객단가 -30%.', lens: 'plan', why: '팬이 마케팅이에요. 지금은 사람을 모을 때예요.' },
        { label: '유료 고객 우선', desc: 'B2B 매출 +$300/월. 열성 사용자 일부가 떠나요(사용자 -5%).', lens: 'sales', why: '돈 내는 고객이 진짜 고객이에요.' },
        { label: '답을 미룬다', desc: '아무 일도 없어요.', lens: 'dev', why: '기능부터 만들고 생각해요.' },
      ],
      defaultChoice: 2,
      params: {},
      domain: 'plan',
    }),
    resolve: (s, c) => {
      const co = s.company!;
      if (c === 2) return { text: '답을 미뤘다. 모임은 조금 실망한 눈치다.', tone: 'info' };
      if (c === 0) { co.users += 200; co.brand = clamp(co.brand + 3, 0, 100); addBuff(s, { label: '열성 사용자 무료 혜택', monthsLeft: 3, arpuMult: 0.7 }); return { text: '모임이 단체로 홍보 글을 올렸다. 가입이 늘었다.', tone: 'good' }; }
      co.enterpriseMrr += 300; co.users = Math.round(co.users * 0.95);
      return { text: '작은 회사 한 곳과 유료 계약을 맺었다.', tone: 'info' };
    },
  },
  {
    id: 'poach',
    weight: 3,
    when: (s) => s.month >= 4 && s.company!.employees.length >= 1,
    make: (s, rng) => {
      const e = bestEmployee(s)!;
      const r = pick(rng, s.rivals);
      const stay = clamp(e.satisfaction / 100, 0.15, 0.9);
      const raise = round50(e.salary * 1.3);
      return {
        title: '인재 빼가기',
        text: `${r.name}(${FACTIONS[r.faction].name})가 ${e.name} 님에게 월급 1.5배를 제안했다. ${e.name} 님은 우리 회사에서 가장 뛰어난 사람이다.`,
        choices: [
          { label: '월급 30% 올려 붙잡기', desc: `월급 ${fmtMoney(e.salary)} → ${fmtMoney(raise)}, 만족도 +15. 고정비가 계속 늘어요.`, lens: 'leadership', why: '확실하게 붙잡아야 해요. 돈으로 해결되는 문제는 쉬운 문제예요.' },
          { label: '스톡옵션 0.5% 주기', desc: '내 지분이 0.5% 줄고 만족도 +25. 현금은 그대로예요.', lens: 'finance', why: '현금은 아끼고 미래 가치를 나눠요. 런웨이를 지키는 쪽이에요.' },
          { label: '설득만 해 본다', desc: `만족도에 따라 남을 수도, 떠날 수도 있어요. 떠나면 ${r.name}가 강해져요.`, lens: 'sales', why: '말로 풀 수 있다고 봐요. 비용 없이 지킬 수 있으면 제일 좋죠.', odds: stay },
        ],
        defaultChoice: 2,
        params: { emp: e.id, rival: r.id, raise, stay },
        domain: 'leadership',
        exclude: e.id,
      };
    },
    resolve: (s, c, p, rng) => {
      const e = emp(s, p.emp!);
      const r = rival(s, p.rival!);
      if (!e) return { text: '이미 회사를 떠난 사람이라 일이 흐지부지됐다.', tone: 'info' };
      if (c === 0) { e.salary = Number(p.raise); e.satisfaction = clamp(e.satisfaction + 15, 0, 100); return { text: `${e.name} 님이 남기로 했다. 월급은 ${fmtMoney(e.salary)}가 됐다.`, tone: 'good' }; }
      if (c === 1) { s.company!.ownership *= 0.995; e.satisfaction = clamp(e.satisfaction + 25, 0, 100); return { text: `${e.name} 님이 스톡옵션을 받고 남았다. 이제 회사의 주인 중 한 명이다.`, tone: 'good' }; }
      if (rng() < Number(p.stay)) { e.satisfaction = clamp(e.satisfaction - 5, 0, 100); return { text: `${e.name} 님이 "그래도 여기가 좋아요"라며 제안을 거절했다.`, tone: 'good' }; }
      s.company!.employees = s.company!.employees.filter((x) => x.id !== e.id);
      s.company!.culture = clamp(s.company!.culture - 4, 0, 100);
      if (r) { r.valuation = Math.round(r.valuation * 1.05); r.momentum += 0.005; }
      return { text: `${e.name} 님이 ${r?.name ?? '경쟁사'}로 떠났다. 팀 분위기가 가라앉았다.`, tone: 'bad' };
    },
  },
  {
    id: 'outage',
    weight: 2,
    when: (s) => s.company!.users >= 300,
    make: (s) => {
      const co = s.company!;
      const credit = round100(Math.max(500, co.mrr * 0.5));
      return {
        title: '대규모 서버 장애',
        text: `새벽 3시, 서비스가 멈췄다. 사용자 ${co.users.toLocaleString()}명이 접속하지 못하고 있다. SNS에 불만 글이 올라오기 시작했다.`,
        choices: [
          { label: '전원 밤샘 복구', desc: '조직 분위기 -8, 직원 만족도 -6, 내 피로 +20. 사용자는 지켜요.', lens: 'dev', why: '지금 고치면 아무도 안 떠나요. 하룻밤이면 됩니다.' },
          { label: '사과문과 보상 크레딧', desc: `현금 -${fmtMoney(credit)}, 브랜드 +3. 사용자는 지켜요.`, lens: 'plan', why: '사용자 신뢰가 먼저예요. 잘 사과하면 오히려 팬이 생겨요.' },
          { label: '조용히 넘긴다', desc: '사용자 -6%, 브랜드 -4. 비용은 없어요.', lens: 'finance', why: '장애는 누구나 겪어요. 돈과 사람을 아끼는 게 낫다고 봐요.' },
        ],
        defaultChoice: 2,
        params: { credit },
        domain: 'dev',
      };
    },
    resolve: (s, c, p) => {
      const co = s.company!;
      if (c === 0) {
        co.culture = clamp(co.culture - 8, 0, 100);
        for (const e of co.employees) e.satisfaction = clamp(e.satisfaction - 6, 0, 100);
        s.player.fatigue = clamp(s.player.fatigue + 20, 0, 100);
        return { text: '아침 7시에 복구했다. 다들 지쳤지만 떠난 사용자는 없다.', tone: 'good' };
      }
      if (c === 1) { co.cash -= Number(p.credit); co.brand = clamp(co.brand + 3, 0, 100); return { text: '진솔한 사과문이 화제가 됐다. "이런 회사라면 믿는다"는 댓글이 달렸다.', tone: 'good' }; }
      const lost = Math.round(co.users * 0.06);
      co.users -= lost; co.brand = clamp(co.brand - 4, 0, 100);
      return { text: `사용자 ${lost.toLocaleString()}명이 떠났다. "또 터졌네"라는 글이 퍼졌다.`, tone: 'bad' };
    },
  },
  {
    id: 'big-client',
    weight: 2,
    when: (s) => s.company!.product >= 30,
    make: (s, rng) => {
      const co = s.company!;
      const deal = round100(Math.max(800, co.mrr * 0.08));
      const client = pick(rng, ['한빛 물산', '대륙 은행', '청해 해운', '서광 그룹', '태백 제철']);
      return {
        title: '대기업의 맞춤 개발 요구',
        text: `${client}이 월 ${fmtMoney(deal)} 계약을 제안했다. 조건은 자기들만 쓰는 기능을 먼저 만들어 달라는 것.`,
        choices: [
          { label: '계약하고 맞춤 개발', desc: `B2B 매출 +${fmtMoney(deal)}/월. 대신 3개월 동안 제품 개발 성과 -40%.`, lens: 'sales', why: '확실한 매출이에요. 대기업 레퍼런스는 돈 주고도 못 사요.' },
          { label: '거절하고 로드맵 유지', desc: '아무 일도 일어나지 않아요. 제품은 계획대로 커요.', lens: 'dev', why: '맞춤 개발은 늪이에요. 우리 제품을 키우는 게 길게 보면 더 벌어요.' },
        ],
        defaultChoice: 1,
        params: { deal, client },
        domain: 'sales',
      };
    },
    resolve: (s, c, p) => {
      if (c === 1) return { text: '정중히 거절했다. 팀은 로드맵에 집중한다.', tone: 'info' };
      s.company!.enterpriseMrr += Number(p.deal);
      addBuff(s, { label: `${p.client} 맞춤 개발`, monthsLeft: 3, task: 'dev', mult: 0.6 });
      return { text: `${p.client}과 계약했다. 개발팀은 석 달 동안 맞춤 기능에 묶인다.`, tone: 'good' };
    },
  },
  {
    id: 'press',
    weight: 2,
    when: (s) => s.month >= 1,
    make: () => {
      const odds = 0.55;
      return {
        title: '테크 언론 인터뷰',
        text: '유명 테크 매체가 인터뷰를 요청했다. 기자는 "업계를 뒤집을 한마디"를 기대하는 눈치다.',
        choices: [
          { label: '파격적인 비전 발표', desc: '성공하면 브랜드 +8, 투자자 평판 +10. 실패하면 과장 논란으로 브랜드 -6.', lens: 'sales', why: '이런 기회는 크게 써야죠. 투자자들이 보고 있어요.', odds },
          { label: '제품 시연에 집중', desc: '브랜드 +3, 내 피로 +12.', lens: 'plan', why: '보여 줄 수 있는 것만 말해요. 확실하게 점수 따는 쪽이에요.' },
          { label: '정중히 거절', desc: '아무 일도 없어요.', lens: 'dev', why: '지금은 제품 만들 시간도 모자라요.' },
        ],
        defaultChoice: 2,
        params: { odds },
        domain: 'sales',
      };
    },
    resolve: (s, c, p, rng) => {
      const co = s.company!;
      if (c === 2) return { text: '인터뷰를 거절했다.', tone: 'info' };
      if (c === 1) { co.brand = clamp(co.brand + 3, 0, 100); s.player.fatigue = clamp(s.player.fatigue + 12, 0, 100); return { text: '담백한 시연 기사가 나갔다. 조용히 문의가 늘었다.', tone: 'good' }; }
      if (rng() < Number(p.odds)) { co.brand = clamp(co.brand + 8, 0, 100); co.irScore = Math.min(200, co.irScore + 10); return { text: '"차세대 유니콘 후보" 헤드라인이 걸렸다. 투자자 전화가 오기 시작했다.', tone: 'good' }; }
      co.brand = clamp(co.brand - 6, 0, 100);
      return { text: '"근거 없는 허풍" 이라는 비판 기사가 이어졌다.', tone: 'bad' };
    },
  },
  {
    id: 'acquire',
    weight: 2,
    when: (s) => s.month >= 14 && s.rivals.length > 3,
    make: (s) => {
      const co = s.company!;
      const target = [...s.rivals].sort((a, b) => a.valuation - b.valuation)[0]!;
      const price = Math.round(Math.max(30_000, target.valuation * 0.16) / 1000) * 1000;
      const users = Math.round(price / 30);
      const talentPrice = Math.round(price * 0.12 / 1000) * 1000;
      if (co.cash < talentPrice) return null;
      return {
        title: 'M&A 제안',
        text: `자금난에 빠진 ${target.name}(${FACTIONS[target.faction].name})가 회사를 넘기겠다고 연락해 왔다. 가치는 ${fmtMoney(target.valuation)}로 평가된다.`,
        choices: [
          { label: `통째로 인수 (${fmtMoney(price)})`, desc: `사용자 +${users.toLocaleString()}명, 에이스 1명 합류, 경쟁사 하나가 사라져요. 2개월 동안 통합 작업으로 전체 성과 -10%.`, lens: 'finance', why: '싸게 나왔어요. 사용자와 사람을 한 번에 사는 거예요.' },
          { label: `핵심 인재만 영입 (${fmtMoney(talentPrice)})`, desc: '에이스 1명만 데려와요(빈자리가 있을 때). 통합 부담은 없어요.', lens: 'leadership', why: '회사는 짐이에요. 사람만 데려오면 돼요.' },
          { label: '지켜본다', desc: '아무 일도 없어요. 다른 회사가 가져갈 수도 있어요.', lens: 'dev', why: '남의 코드를 떠안을 여유가 없어요.' },
        ],
        defaultChoice: 2,
        params: { rival: target.id, price, users, talentPrice },
        domain: 'finance',
      };
    },
    resolve: (s, c, p, rng) => {
      const co = s.company!;
      const r = rival(s, p.rival!);
      if (c === 2 || !r) return { text: '인수를 보류했다.', tone: 'info' };
      const price = c === 0 ? Number(p.price) : Number(p.talentPrice);
      if (co.cash < price) return { text: '현금이 모자라 협상이 결렬됐다.', tone: 'bad' };
      if (c === 1 && co.employees.length >= MAX_EMPLOYEES) return { text: '자리가 꽉 차 영입을 포기했다.', tone: 'info' };
      co.cash -= price;
      const ace = aceCandidate(rng, `ace-${s.month}`, `${r.name.split(' ')[0]} 출신 ${pick(rng, ['도윤', '서연', '하준', '지우', '민재'])}`);
      const joined = co.employees.length < MAX_EMPLOYEES;
      // 인수로 넘어온 사람은 웃돈 없이 시장가 월급으로 온다
      const salary = askingSalary(ace.stats);
      if (joined) co.employees.push({ id: ace.id, name: ace.name, stats: ace.stats, salary, satisfaction: 65, task: 'dev', hiredMonth: s.month });
      if (c === 1) return { text: `${ace.name} 님이 합류했다(제품 개발 배정, 월급 ${fmtMoney(salary)}).`, tone: 'good' };
      co.users += Number(p.users);
      co.culture = clamp(co.culture - 5, 0, 100);
      addBuff(s, { label: `${r.name} 통합 작업`, monthsLeft: 2, task: 'all', mult: 0.9 });
      s.rivals = s.rivals.filter((x) => x.id !== r.id);
      return { text: `${r.name}를 인수했다. 사용자 ${Number(p.users).toLocaleString()}명${joined ? `과 ${ace.name} 님` : ''}이 넘어왔다.`, tone: 'good' };
    },
  },
  {
    id: 'copycat',
    weight: 2,
    when: (s) => s.month >= 6 && s.company!.users >= 500,
    make: (s, rng) => {
      const r = pick(rng, s.rivals);
      return {
        title: '기능 베끼기',
        text: `${r.name}가 우리 핵심 기능을 그대로 베낀 제품을 반값에 내놨다. 사용자들이 비교 글을 올리고 있다.`,
        choices: [
          { label: '가격 인하로 맞대응', desc: '4개월 동안 객단가 -20%, 이탈률 -2%p.', lens: 'sales', why: '가격으로 눌러야 해요. 사용자를 뺏기면 되찾기 어려워요.' },
          { label: '신기능 스프린트', desc: '2개월 동안 개발 성과 +30%, 직원 만족도 -5, 조직 분위기 -4.', lens: 'dev', why: '베낄 수 없는 걸 만들면 돼요. 한 발 앞서 나가요.' },
          { label: '무시한다', desc: '4개월 동안 이탈률 +2%p.', lens: 'finance', why: '반값 짝퉁은 오래 못 가요. 괜히 돈 쓰지 마요.' },
        ],
        defaultChoice: 2,
        params: { rival: r.id },
        domain: 'plan',
      };
    },
    resolve: (s, c, p) => {
      const name = rival(s, p.rival!)?.name ?? '경쟁사';
      if (c === 0) { addBuff(s, { label: `${name}와 가격 전쟁`, monthsLeft: 4, arpuMult: 0.8, churnAdd: -0.02 }); return { text: '가격을 내렸다. 사용자는 남았지만 매출이 줄었다.', tone: 'info' }; }
      if (c === 1) {
        addBuff(s, { label: '신기능 스프린트', monthsLeft: 2, task: 'dev', mult: 1.3 });
        for (const e of s.company!.employees) e.satisfaction = clamp(e.satisfaction - 5, 0, 100);
        s.company!.culture = clamp(s.company!.culture - 4, 0, 100);
        return { text: '개발팀이 다시 달리기 시작했다.', tone: 'good' };
      }
      addBuff(s, { label: `${name} 짝퉁에 사용자 이탈`, monthsLeft: 4, churnAdd: 0.02 });
      return { text: '무시하기로 했다. 일부 사용자가 반값 제품으로 옮겨 간다.', tone: 'bad' };
    },
  },
  {
    id: 'burnout',
    weight: 2,
    when: (s) => s.company!.employees.some((e) => e.satisfaction < 55) || (s.company!.crunchMonths > 0 && s.company!.employees.length > 0),
    make: (s) => {
      const e = [...s.company!.employees].sort((a, b) => a.satisfaction - b.satisfaction)[0]!;
      const bonus = round50(e.salary);
      return {
        title: '번아웃 호소',
        text: `${e.name} 님이 면담을 요청했다. "요즘 너무 지쳤어요. 이대로는 못 버틸 것 같아요." (만족도 ${Math.round(e.satisfaction)})`,
        choices: [
          { label: '한 달 유급 휴가', desc: `이번 달 ${e.name} 님 성과 0, 만족도 +30.`, lens: 'leadership', why: '푹 쉬고 오면 더 잘해요. 사람을 잃는 게 제일 비싸요.' },
          { label: `보너스 지급 (${fmtMoney(bonus)})`, desc: '만족도 +15. 일은 계속해요.', lens: 'finance', why: '일은 멈추지 않고 마음도 달랠 수 있어요.' },
          { label: '조금만 버텨 달라고 한다', desc: '만족도 -12. 더 떨어지면 퇴사할 수 있어요.', lens: 'dev', why: '지금이 제일 중요한 시기예요. 모두 같이 버티는 거죠.' },
        ],
        defaultChoice: 2,
        params: { emp: e.id, bonus },
        domain: 'leadership',
        exclude: e.id,
      };
    },
    resolve: (s, c, p) => {
      const e = emp(s, p.emp!);
      if (!e) return { text: '이미 떠난 사람이다.', tone: 'info' };
      if (c === 0) { e.satisfaction = clamp(e.satisfaction + 30, 0, 100); addBuff(s, { label: `${e.name} 휴가`, monthsLeft: 1, workerId: e.id, mult: 0 }); return { text: `${e.name} 님이 휴가를 떠났다. "다녀와서 제대로 할게요."`, tone: 'good' }; }
      if (c === 1) { s.company!.cash -= Number(p.bonus); e.satisfaction = clamp(e.satisfaction + 15, 0, 100); return { text: `${e.name} 님 표정이 조금 밝아졌다.`, tone: 'good' }; }
      e.satisfaction = clamp(e.satisfaction - 12, 0, 100);
      return { text: `${e.name} 님이 말없이 자리로 돌아갔다.`, tone: 'bad' };
    },
  },
  {
    id: 'bridge',
    weight: 4,
    when: (s) => {
      const co = s.company!;
      const burn = monthlyCost(s) + (co.adBudget ?? 0) - co.mrr;
      return s.month >= 3 && burn > 0 && co.cash < burn * 5;
    },
    make: (s) => {
      const co = s.company!;
      const amount = Math.round(Math.max(20_000, monthlyCost(s) * 4) / 1000) * 1000;
      const personal = s.player.personalCash >= 500;
      const payroll = co.employees.reduce((a, e) => a + e.salary, 0);
      const giveback = round100(payroll * 0.3);
      return {
        title: '현금 위기',
        text: `현금이 ${fmtMoney(co.cash)} 남았다. 이대로면 몇 달 안에 바닥난다. 오래 알고 지낸 엔젤 투자자가 브릿지 투자를 제안했다.`,
        choices: [
          { label: `브릿지 투자 받기 (+${fmtMoney(amount)})`, desc: '내 지분이 6% 줄어요(지금 지분의 6%).', lens: 'finance', why: '살아남는 게 먼저예요. 지분은 나중에 키우면 돼요.' },
          personal
            ? { label: `개인 자금 넣기 (+${fmtMoney(s.player.personalCash)})`, desc: '부업으로 모은 개인 자금을 전부 회사에 넣어요. 지분은 그대로예요.', lens: 'leadership', why: '대표가 먼저 걸면 팀도 따라와요.' }
            : { label: `급여 일부 반납 요청 (+${fmtMoney(giveback)})`, desc: '직원 만족도 -10. 지분은 그대로예요.', lens: 'leadership', why: '함께 고비를 넘기자고 솔직하게 말해요.' },
          { label: '버텨 본다', desc: '아무 일도 없어요. 두 달 연속 현금이 마이너스면 파산이에요.', lens: 'sales', why: '곧 매출이 터질 거예요. 지분을 싸게 넘기지 마요.' },
        ],
        defaultChoice: 2,
        params: { amount, personal: personal ? 1 : 0, giveback },
        domain: 'finance',
      };
    },
    resolve: (s, c, p) => {
      const co = s.company!;
      if (c === 0) { co.cash += Number(p.amount); co.ownership *= 0.94; return { text: `브릿지 투자 ${fmtMoney(Number(p.amount))}가 들어왔다. 한숨 돌렸다.`, tone: 'good' }; }
      if (c === 1 && Number(p.personal)) { const v = s.player.personalCash; co.cash += v; s.player.personalCash = 0; return { text: `개인 자금 ${fmtMoney(v)}를 회사에 넣었다.`, tone: 'info' }; }
      if (c === 1) { co.cash += Number(p.giveback); for (const e of co.employees) e.satisfaction = clamp(e.satisfaction - 10, 0, 100); return { text: '직원들이 급여 일부를 반납했다. 사무실이 조용하다.', tone: 'info' }; }
      return { text: '버티기로 했다.', tone: 'info' };
    },
  },
  {
    id: 'viral',
    weight: 2,
    when: (s) => s.month >= 3 && s.company!.users >= 500,
    make: (s) => {
      const co = s.company!;
      const cost = round100(Math.max(3000, co.mrr * 0.4));
      const odds = 0.5;
      return {
        title: '갑자기 화제가 됐다',
        text: '유명 인플루언서가 우리 서비스를 소개했다. 가입자가 몰려들기 시작했다. 서버가 버틸지 모르겠다.',
        choices: [
          { label: `광고로 올라타기 (${fmtMoney(cost)})`, desc: `사용자 약 +${Math.round(cost / 12).toLocaleString()}명. 보통 광고보다 싸요.`, lens: 'sales', why: '파도가 왔을 때 올라타야죠. 이 단가는 다시 안 와요.' },
          { label: '서버만 증설 ($1,500)', desc: '사용자 +5%. 안전하게 받아요.', lens: 'dev', why: '들어오는 사람을 안 놓치는 게 먼저예요.' },
          { label: '그냥 둔다', desc: '운이 좋으면 사용자 +8%, 아니면 서버가 터져 사용자 -4%, 브랜드 -3.', lens: 'finance', why: '돈 안 쓰고도 잘 될 수 있어요.', odds },
        ],
        defaultChoice: 2,
        params: { cost, odds },
        domain: 'dev',
      };
    },
    resolve: (s, c, p, rng) => {
      const co = s.company!;
      if (c === 0) { const n = Math.round(Number(p.cost) / 12); co.cash -= Number(p.cost); co.users += n; return { text: `광고를 붙였다. 사용자 ${n.toLocaleString()}명이 들어왔다.`, tone: 'good' }; }
      if (c === 1) { co.cash -= 1500; const n = Math.round(co.users * 0.05); co.users += n; return { text: `서버를 늘렸다. 사용자 ${n.toLocaleString()}명이 무사히 가입했다.`, tone: 'good' }; }
      if (rng() < Number(p.odds)) { const n = Math.round(co.users * 0.08); co.users += n; return { text: `운이 좋았다. 서버가 버텼고 사용자 ${n.toLocaleString()}명이 늘었다.`, tone: 'good' }; }
      const n = Math.round(co.users * 0.04); co.users -= n; co.brand = clamp(co.brand - 3, 0, 100);
      return { text: `서버가 터졌다. 사용자 ${n.toLocaleString()}명이 떠났다.`, tone: 'bad' };
    },
  },
  {
    id: 'hackathon',
    weight: 1,
    when: (s) => s.company!.employees.length >= 3,
    make: () => ({
      title: '사내 해커톤 제안',
      text: '직원들이 이번 달에 사내 해커톤을 열자고 한다. 재밌는 아이디어가 많다고.',
      choices: [
        { label: '해커톤 연다', desc: '이번 달 전체 성과 -25%. 대신 완성도 +2, AI 점수 +12, 조직 분위기 +6.', lens: 'ai', why: '새 아이디어는 이럴 때 나와요. 분위기도 살고요.' },
        { label: '평소대로 일한다', desc: '아무 일도 없어요.', lens: 'finance', why: '지금은 실적이 더 중요해요.' },
      ],
      defaultChoice: 1,
      params: {},
      domain: 'plan',
    }),
    resolve: (s, c) => {
      const co = s.company!;
      if (c === 1) return { text: '해커톤은 다음 기회로 미뤘다.', tone: 'info' };
      addBuff(s, { label: '해커톤', monthsLeft: 1, task: 'all', mult: 0.75 });
      co.product = Math.min(100, co.product + 2); co.aiScore += 12; co.culture = clamp(co.culture + 6, 0, 100);
      return { text: '밤새 피자를 먹으며 만든 프로토타입 세 개가 나왔다.', tone: 'good' };
    },
  },
  {
    id: 'faction-call',
    weight: 1,
    when: (s) => s.month >= 5,
    make: (s) => {
      const f = FACTIONS[s.company!.faction];
      return {
        title: '진영의 부름',
        text: `${f.name} 맹주가 연합 프로젝트에 대표님이 직접 참여해 달라고 요청했다.`,
        choices: [
          { label: '직접 참여한다', desc: '2개월 동안 내 성과 -50%. 투자자 평판 +10, 브랜드 +3.', lens: 'sales', why: '맹주 눈에 들면 다음 투자가 쉬워져요.' },
          { label: '직원을 대신 보낸다', desc: '가장 리더십 높은 직원의 성과가 2개월 동안 -50%. 투자자 평판 +6.', lens: 'leadership', why: '체면은 세우고 대표님은 회사를 지켜요.' },
          { label: '정중히 거절', desc: '아무 일도 없어요.', lens: 'dev', why: '우리 일도 바빠요.' },
        ],
        defaultChoice: 2,
        params: {},
        domain: 'sales',
      };
    },
    resolve: (s, c) => {
      const co = s.company!;
      if (c === 2) return { text: '참여를 거절했다.', tone: 'info' };
      if (c === 0) { addBuff(s, { label: '연합 프로젝트(대표)', monthsLeft: 2, workerId: 'player', mult: 0.5 }); co.irScore = Math.min(200, co.irScore + 10); co.brand = clamp(co.brand + 3, 0, 100); return { text: '맹주와 같은 무대에 섰다. 투자자들 사이에 이름이 돌기 시작했다.', tone: 'good' }; }
      const e = [...co.employees].sort((a, b) => b.stats.leadership - a.stats.leadership)[0];
      if (!e) return { text: '보낼 직원이 없어 거절했다.', tone: 'info' };
      addBuff(s, { label: `연합 프로젝트(${e.name})`, monthsLeft: 2, workerId: e.id, mult: 0.5 });
      co.irScore = Math.min(200, co.irScore + 6);
      return { text: `${e.name} 님이 대표로 참여했다.`, tone: 'good' };
    },
  },
  {
    id: 'ace-poach',
    weight: 2,
    when: (s) => s.month >= 4 && s.company!.employees.length < MAX_EMPLOYEES,
    make: (s, rng) => {
      const r = pick(rng, s.rivals);
      return {
        title: '경쟁사 에이스의 이직 신호',
        text: `${r.name}의 핵심 인재가 이직을 고민한다는 소문이 들린다. 지금 연락하면 데려올 수 있을지도 모른다.`,
        choices: [
          { label: '빼온다', desc: '능력치가 뛰어나고 이미 검증된 후보가 채용 탭에 나와요. 대신 시장가의 1.4배를 원해요. 경쟁사가 약해져요.', lens: 'leadership', why: '이런 사람은 시장에 안 나와요. 무조건 잡아요.' },
          { label: '지켜본다', desc: '아무 일도 없어요.', lens: 'finance', why: '비싼 사람 하나보다 적당한 사람 둘이 나아요.' },
        ],
        defaultChoice: 1,
        params: { rival: r.id },
        domain: 'leadership',
      };
    },
    resolve: (s, c, p, rng) => {
      if (c === 1) return { text: '연락하지 않았다.', tone: 'info' };
      const r = rival(s, p.rival!);
      const ace = aceCandidate(rng, `ace-${s.month}`, `${pick(rng, ['남궁', '황보', '제갈', '선우'])}${pick(rng, ['태오', '하린', '지안', '유찬'])}`);
      s.candidates = [...s.candidates, ace].slice(-8);
      if (r) r.momentum = Math.max(0.01, r.momentum - 0.01);
      return { text: `${ace.name} 님과 만났다. 채용 탭에서 제안할 수 있다(희망 월급 ${fmtMoney(ace.ask)}).`, tone: 'good' };
    },
  },
  {
    id: 'audit',
    weight: 1,
    when: (s) => s.month >= 10 && s.company!.mrr >= 3000,
    make: (s) => {
      const co = s.company!;
      const fine = round100(Math.max(3000, co.mrr * 0.6));
      const fin = Math.max(effectiveStats(s.player).finance, ...co.employees.filter((e) => e.task === 'finance').map((e) => e.stats.finance));
      const odds = clamp(0.25 + fin / 120, 0.3, 0.9);
      return {
        title: '세무 조사',
        text: '국세청에서 세무 조사를 나온다는 통보가 왔다. 장부가 깔끔한지 자신이 없다.',
        choices: [
          { label: `회계법인에 맡기기 (${fmtMoney(fine * 0.35)})`, desc: '확실하게 끝나요.', lens: 'leadership', why: '전문가에게 맡기는 게 제일 싸게 먹혀요.' },
          { label: '직접 대응', desc: `내 피로 +25. 재무 능력이 높을수록 무사히 넘어가요. 실패하면 추징금 ${fmtMoney(fine)}.`, lens: 'finance', why: '장부는 제가 잘 알아요. 직접 하면 돈 안 들어요.', odds },
        ],
        defaultChoice: 1,
        params: { fine, odds },
        domain: 'finance',
      };
    },
    resolve: (s, c, p, rng) => {
      const co = s.company!;
      if (c === 0) { co.cash -= Math.round(Number(p.fine) * 0.35); return { text: '회계법인이 깔끔하게 마무리했다.', tone: 'info' }; }
      s.player.fatigue = clamp(s.player.fatigue + 25, 0, 100);
      if (rng() < Number(p.odds)) return { text: '밤새 장부를 맞춰 무사히 넘어갔다.', tone: 'good' };
      co.cash -= Number(p.fine);
      return { text: `실수가 발견돼 추징금 ${fmtMoney(Number(p.fine))}을 냈다.`, tone: 'bad' };
    },
  },
  {
    id: 'open-source',
    weight: 1,
    when: (s) => s.company!.product >= 25,
    make: () => ({
      title: '오픈소스 공개 제안',
      text: '개발팀이 핵심 모듈을 오픈소스로 공개하자고 한다. 개발자 커뮤니티에서 이름을 알릴 기회지만, 경쟁사도 가져다 쓸 수 있다.',
      choices: [
        { label: '공개한다', desc: '브랜드 +6, 조직 분위기 +4, 개발자 후보 +2명. 대신 경쟁사도 가져다 써서 6개월 동안 이탈률 +1.5%p.', lens: 'dev', why: '좋은 개발자는 좋은 코드를 보고 와요.' },
        { label: '비공개 유지', desc: '아무 일도 없어요.', lens: 'sales', why: '우리 무기를 왜 남에게 줘요.' },
      ],
      defaultChoice: 1,
      params: {},
      domain: 'dev',
    }),
    resolve: (s, c, _p, rng) => {
      if (c === 1) return { text: '코드를 비공개로 유지했다.', tone: 'info' };
      const co = s.company!;
      co.brand = clamp(co.brand + 6, 0, 100); co.culture = clamp(co.culture + 4, 0, 100);
      for (const r of s.rivals) r.momentum += 0.003;
      addBuff(s, { label: '공개 코드로 만든 경쟁 제품', monthsLeft: 6, churnAdd: 0.015 });
      const extra = [0, 1].map((i) => {
        const a = aceCandidate(rng, `os-${s.month}-${i}`, `${pick(rng, ['오픈', '깃', '커밋'])}${pick(rng, ['준', '린', '솔'])}`);
        // 오픈소스 기여자: 에이스만큼은 아니고 추정 범위도 넓다
        for (const st of STATS) { a.stats[st] = Math.max(20, a.stats[st] - 8); a.estimate[st] = { lo: Math.max(0, a.stats[st] - 12), hi: Math.min(100, a.stats[st] + 12) }; }
        a.ask = round50(askingSalary(a.stats)); a.interviewed = 'none'; a.liveProbesLeft = 3;
        return a;
      });
      s.candidates = [...s.candidates, ...extra].slice(-8);
      return { text: '깃허브 별이 쏟아졌다. 함께 일하고 싶다는 개발자 두 명이 연락해 왔다.', tone: 'good' };
    },
  },
];

// ---------- 참모 조언 ----------

/** 확률 추정 오차(±%p). 해당 능력치가 높을수록 정확하다. */
export function adviceError(stat: number): number {
  return clamp(Math.round(40 - stat * 0.45), 4, 30);
}

function makeAdvice(s: GameState, m: Made, rng: Rng): Advice[] {
  const people = s.company!.employees
    .filter((e) => e.id !== m.exclude)
    .sort((a, b) => b.stats[m.domain] - a.stats[m.domain])
    .slice(0, MAX_ADVISORS);
  return people.map((e) => {
    if (e.satisfaction < ADVICE_MIN_SATISFACTION) return { who: e.name, pick: -1, text: '글쎄요… 대표님이 알아서 하시죠.' };
    let best = 0;
    m.choices.forEach((c, i) => { if (e.stats[c.lens] > e.stats[m.choices[best]!.lens]) best = i; });
    const c = m.choices[best]!;
    let text = c.why;
    const risky = m.choices.find((x) => x.odds !== undefined);
    if (risky) {
      const err = adviceError(e.stats[m.domain]);
      const guess = clamp(Math.round((risky.odds! + uniform(rng, -err, err) / 100) * 20) * 5, 5, 95);
      text += ` '${risky.label}'이 잘될 확률은 ${guess}% 정도로 봐요.`;
    }
    return { who: `${e.name} · ${STAT_LABEL[m.domain]} ${Math.round(e.stats[m.domain])}`, pick: best, text };
  });
}

// ---------- 뽑기·결정 ----------

export function drawDilemma(s: GameState): DilemmaState | null {
  if (s.phase !== 'play' || !s.company || s.month < 1) return null;
  const seen = s.dilemmaSeen ?? [];
  const rng = rngFor(s.seed, 'dilemma', s.month);
  const pool = DILEMMAS.filter((d) => d.when(s) && !seen.some((x) => x.id === d.id && s.month - x.month < DILEMMA_COOLDOWN));
  // 가중치 순서대로 시도하되, make가 null이면 다음 후보
  const bag = [...pool];
  while (bag.length) {
    const total = bag.reduce((a, d) => a + d.weight, 0);
    let r = rng() * total;
    const i = bag.findIndex((d) => (r -= d.weight) < 0);
    const def = bag.splice(i < 0 ? 0 : i, 1)[0]!;
    const m = def.make(s, rng);
    if (!m) continue;
    return {
      id: def.id,
      title: m.title,
      text: m.text,
      choices: m.choices.map(({ label, desc }) => ({ label, desc })),
      defaultChoice: m.defaultChoice,
      params: m.params,
      advice: makeAdvice(s, m, rngFor(s.seed, 'advice', s.month)),
      chosen: null,
      result: null,
      tone: null,
    };
  }
  return null;
}

/** 결단 카드에 답한다. 효과는 그 자리에서 적용되고(다음 정산 예상에도 바로 반영), 결과 글이 남는다. */
export function resolveDilemma(state: GameState, choice: number, auto = false): GameState {
  const d = state.dilemma;
  if (!d || d.chosen !== null || !state.company) return state;
  const def = DILEMMAS.find((x) => x.id === d.id);
  if (!def || choice < 0 || choice >= d.choices.length) return state;
  const s = structuredClone(state);
  const out = def.resolve(s, choice, d.params, rngFor(s.seed, 'dilemma-out', s.month, d.id));
  s.dilemma = { ...d, chosen: choice, result: out.text, tone: out.tone };
  s.dilemmaSeen = [...(s.dilemmaSeen ?? []), { id: d.id, month: s.month }].slice(-20);
  pushLog(s, `[${d.title}] ${auto ? '결정을 미뤘다 → ' : ''}${d.choices[choice]!.label}: ${out.text}`, out.tone);
  return s;
}
