# Bitcoin Cycle Charts - React 컴포넌트

Supabase에서 데이터를 가져와 ApexCharts로 시각화하는 React 컴포넌트입니다.

## 📁 파일 구조

```
react-charts/
├── components/
│   ├── CycleComparisonChart.jsx  # 사이클 비교 차트
│   ├── BearBoxChart.jsx          # 하락장 박스권 차트
│   ├── BullBoxChart.jsx          # 상승장 박스권 차트
│   └── index.js                  # 컴포넌트 내보내기
├── hooks/
│   └── useChartData.js           # 데이터 로딩 커스텀 훅
├── utils/
│   └── chartData.js              # 데이터 처리 및 박스권 계산 로직
├── styles/
│   └── Chart.css                 # 공통 스타일
├── lib/
│   └── supabase.js               # Supabase 클라이언트
└── README.md
```

## 🚀 설치

### 1. 필요한 패키지 설치

```bash
npm install @supabase/supabase-js apexcharts react-apexcharts
```

### 2. 환경 변수 설정

`.env.local` 파일에 Supabase 정보 추가:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. 파일 복사

`react-charts` 폴더의 내용을 프로젝트에 복사:

```
src/
├── components/charts/     ← components/ 내용 복사
├── hooks/                 ← hooks/ 내용 복사
├── utils/                 ← utils/ 내용 복사
├── styles/                ← styles/ 내용 복사
└── lib/                   ← lib/ 내용 복사
```

## 📊 사용법

### 사이클 비교 차트

```jsx
import { CycleComparisonChart } from '@/components/charts'

export default function Page() {
  return <CycleComparisonChart />
}
```

### 하락장 박스권 차트

```jsx
import { BearBoxChart } from '@/components/charts'

export default function Page() {
  // cycleNumber: 분석할 사이클 번호 (기본값: 4)
  return <BearBoxChart cycleNumber={4} />
}
```

### 상승장 박스권 차트

```jsx
import { BullBoxChart } from '@/components/charts'

export default function Page() {
  // cycleNumber: 분석할 사이클 번호 (기본값: 3)
  return <BullBoxChart cycleNumber={3} />
}
```

## ⚙️ 설정 변경

`utils/chartData.js`에서 설정 변경 가능:

```javascript
// Bear (하락장) 설정
export const BEAR_CONFIG = {
  RISE_THRESHOLD: 5.0,       // 박스 인식을 위한 최소 상승률 (%)
  BREAK_THRESHOLD: 2.0,      // 박스 이탈 기준 (%)
  MIN_DURATION_DAYS: 1,      // 최소 박스 기간 (일)
  MAX_DURATION_DAYS: 420,    // 최대 분석 기간 (일)
  MIN_DROP_FROM_PREV_HIGH: 3.0,  // 이전 고점 대비 최소 하락률 (%)
}

// Bull (상승장) 설정
export const BULL_CONFIG = {
  MIN_DAYS_FROM_PEAK: 420,   // 420일부터 상승장 분석
  DROP_THRESHOLD: 5.0,       // 하락률 5% 이상
  BREAK_THRESHOLD: 2.0,      // 고점에서 2% 이상 상승 시 박스 종료
  MIN_DURATION_DAYS: 1,
  LOOKBACK_DAYS: 10,         // N일 범위에서 최고점일 때만 고점으로 인정
}
```

## 🗄️ 데이터베이스 구조

Supabase `bitcoin_cycle_data` 테이블:

| 컬럼 | 타입 | 설명 |
|------|------|------|
| cycle_number | int | 사이클 번호 (1, 2, 3, 4) |
| days_since_peak | int | 고점 이후 일수 |
| timestamp | timestamp | 날짜 |
| close_rate | float | 종가 비율 (%) |
| low_rate | float | 저가 비율 (%) |
| high_rate | float | 고가 비율 (%) |

## 🎨 스타일 커스터마이징

`styles/Chart.css`에서 CSS 변수 수정:

```css
:root {
  --bg-primary: #020617;
  --bg-secondary: #0F172A;
  --text-primary: #F8FAFC;
  --color-blue: #3B82F6;
  /* ... */
}
```

## 📱 반응형 지원

- 모바일 (768px 이하): 컴팩트 레이아웃
- 터치 디바이스: 버튼 크기 증가

## 🔄 기존 Python 코드와의 차이점

| 항목 | Python (기존) | React (신규) |
|------|--------------|-------------|
| 데이터 로딩 | Python에서 fetch | 브라우저에서 직접 fetch |
| 박스권 계산 | Python (Pandas) | JavaScript |
| 출력 형식 | HTML 파일 | React 컴포넌트 |
| 실시간 데이터 | 재실행 필요 | 자동 갱신 가능 |
