# w3game3c · 테크 삼국지

가상 아바타로 스타트업을 세우고, 직원에게 업무를 맡기고, 투자를 받으며 세 거대 진영의 패권을 다투는 자동 진행형 소셜게임입니다.

- 설계 문서: `docs/design-v0.1.md`
- 체험판: https://madenmud.github.io/w3game3c/ (GitHub Pages 설정 후)

## 체험판(MVP) 범위

브라우저 하나로 혼자 한 시즌(56개월)을 플레이합니다. 서버 없이 정적 페이지로 돌고, 저장은 브라우저 localStorage에 합니다.

| 들어 있음 | 목업 또는 다음 단계 |
| --- | --- |
| 아바타 생성(능력치 6개, 총합 고정) | GitHub·LinkedIn 연동은 프로필 유형 선택으로 대체 |
| 창업과 진영 제휴, 진영 패권 순위, 월별 사건 | 다른 플레이어(직원·후보)는 NPC로 대체 |
| 면접(실시간 질문 / 위임), 채용 제안, 업무 배정, 만족도·퇴사 | 실시간 면접 채팅 |
| 월 정산(성과식, 지표, 현금, 파산) | 매일 09:00 자동 정산(체험판은 버튼으로 진행) |
| 개인 스케줄(수업·휴식·부업·네트워킹), 피로, 성장, 특성 | 동료 멘토링 |
| 학습 카드(맞히면 보너스, 틀리면 2개월 뒤 재출제) | |
| 투자 라운드(엔젤~시리즈 B), 지분 희석 | |
| 상점, 개인별 착용 한도, 월 결제 한도 | USDC 결제는 테스트 결제 버튼 |
| HEU 가산, 운동 연동 체력 | 지갑 서명·Strava/Garmin 연동은 숫자 입력 |

## 개발

```bash
npm install
npm run dev      # http://localhost:5173/w3game3c/
npm test         # 규칙·밸런스 테스트
npm run build
```

- `src/engine/` 정산 엔진(순수 함수, 결정적 난수). 나중에 Cloudflare Workers에서도 그대로 쓴다.
- `src/engine/bots.ts` 밸런스 검증용 자동 플레이어.
- `src/ui/` 화면(프레임워크 없이 TypeScript).

## 배포

`main`에 머지하면 GitHub Actions가 테스트·빌드 후 GitHub Pages에 배포합니다. 저장소 Settings → Pages → Source를 **GitHub Actions**로 한 번 설정해야 합니다.
