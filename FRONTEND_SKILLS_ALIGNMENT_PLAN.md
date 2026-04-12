# Frontend Skills Alignment Plan

## 목적

이 문서는 `E:\source\btcReack20260222_fb\.agents\skills`의 프론트엔드 품질 기준에 맞춰
`01_frontend/`를 단계적으로 개선하기 위한 실행 계획서다.

이번 정비의 목표는 단순히 화면이 보이는 수준을 넘어서,
차트 중심의 제품형 UI와 유지보수 가능한 구조를 함께 만드는 것이다.

적용 기준 스킬:

- `impeccable`
- `critique`
- `audit`
- `adapt`
- `typeset`
- `layout`
- `colorize`
- `polish`

## 진행 현황

### 완료

- `Phase 1` 텍스트 안정화 완료
- 디자인 토큰 및 테마 분리 완료
- 레이아웃 재구성 완료
- 구조 분리 완료
- 미사용 잔여 파일 정리 완료
- 미사용 훅/API 정리 완료
  - `useBearPrediction` 제거
  - `fetchConfig` 제거
  - `useCycleComparisonData`의 미사용 상태 제거
- 빌드 검증 완료
  - `01_frontend`에서 `npm run build` 반복 검증 성공

### 진행중

- 없음

### 미착수

- 없음

## 현재 진단 요약

기존 프론트는 기능은 동작하지만 제품형 차트 대시보드로 보기에는 한계가 있었다.

- 텍스트가 깨진 구간이 있어 신뢰감과 가독성이 떨어졌다.
- 색상과 spacing, 배경 처리가 하드코딩되어 있어 테마 확장이 어려웠다.
- 거래소 스타일과 템플릿 스타일이 섞여 시각적 방향성이 약했다.
- 모바일에서 단순 축소에 가까운 구간이 있어 정보 우선순위가 불명확했다.
- 공통 표현 방식이 분산되어 유지보수성이 낮았다.

## 목표 상태

수정 후 프론트는 아래 상태를 목표로 한다.

- 텍스트와 UX 카피가 모두 정상 표기되고 의미가 명확하다.
- 색상, spacing, 타이포가 토큰 기반으로 관리된다.
- 비트코인 사이클 분석에 맞는 차분하고 신뢰감 있는 다크 UI를 가진다.
- 데스크톱에서는 차트 집중형, 모바일에서는 정보 우선순위 중심 구조를 제공한다.
- 접근성과 반응형 품질이 기본 이상 확보된다.
- `.agents/skills` 기준에서 봐도 제품형 프론트로 읽힌다.

## 적용 대상

- `01_frontend/src/App.jsx`
- `01_frontend/src/styles/App.css`
- `01_frontend/src/components/CycleComparisonChart.jsx`
- `01_frontend/src/components/BearBoxChart.jsx`
- `01_frontend/src/components/BullBoxChart.jsx`
- `01_frontend/src/components/TradingChart.jsx`
- `01_frontend/src/hooks/useChartData.js`
- `01_frontend/src/lib/api.js`
- `01_frontend/src/index.css`
- 신규/정리 파일
  - `01_frontend/src/styles/tokens.css`
  - `01_frontend/src/styles/theme.css`
  - `01_frontend/src/components/ChartStatus.jsx`
  - `01_frontend/src/components/layout/*`

## 산출물 체크리스트

- [x] 깨진 주요 텍스트 복구
- [x] 메뉴/헤더/차트 주요 문구 정리
- [x] 공통 사용자 토큰 도입
- [x] 테마 파일 분리 (`theme.css`)
- [x] 하드코딩 색상 대량 제거
- [x] 사이드바/헤더/레이아웃 구조 개선
- [x] 공통 상태 컴포넌트 분리
- [x] 레이아웃 컴포넌트 분리 시작
- [x] 미사용 잔여 파일 정리
- [x] 미사용 훅/API 정리
- [x] 모바일 화면 최적화
- [x] 접근성 aria 상태 보강
- [x] 인라인 스타일 최소화
- [x] 최종 polish pass 완료

## 완료 기준

아래 조건을 만족하면 본 계획의 1차 완료로 본다.

- 프론트의 텍스트가 깨지지 않고 의미가 명확하다.
- 주요 UI가 토큰 기반으로 정리되어 수정 비용이 낮다.
- 현재 UI가 `.agents/skills` 기준에서도 제품형 프론트로 읽힌다.
- 모바일에서도 탐색과 차트 사용이 자연스럽다.
- 다음 `/critique` 또는 `/audit`에서도 현재보다 명확한 개선 평가를 받을 수 있다.


