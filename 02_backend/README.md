# Backend — Bitcoin Cycle Analyzer API

FastAPI 기반 백엔드. Supabase DB 접근 + 박스권 계산 + 예측 로직을 모두 서버에서 처리합니다.

## 폴더 구조

```
02_backend/
├── app/
│   ├── main.py              # FastAPI 앱, CORS 설정
│   ├── config.py            # BEAR/BULL 설정, Supabase 키
│   ├── db.py                # Supabase 클라이언트
│   ├── routers/
│   │   ├── cycle.py         # /api/cycle-*, /api/bear-*, /api/bull-*
│   │   └── trading.py       # /api/ohlcv
│   ├── services/
│   │   ├── cycle_data.py    # 데이터 조회/가공
│   │   ├── bear_box.py      # Bear 박스권 계산
│   │   ├── bull_box.py      # Bull 박스권 계산
│   │   └── prediction.py    # C4 예측 (ES, 유사사이클, 클램핑)
│   └── utils/
│       └── math_utils.py    # exponential_smooth, find_most_similar_cycle
├── requirements.txt
├── render.yaml              # Render 배포 설정
├── Procfile
└── .env.example
```

## 로컬 개발

```bash
# 저장소 루트에서
cd 02_backend

# 1) 가상환경
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2) 패키지 설치
pip install -r requirements.txt

# 3) 환경변수 설정
cp .env.example .env
# .env 파일에 SUPABASE_URL, SUPABASE_KEY 입력

# 4) 서버 실행
uvicorn app.main:app --reload --port 8000
```

### 프론트엔드 (저장소 루트 `01_frontend/`)

```bash
# 저장소 루트에서
cd 01_frontend
npm install
npm run dev
```

`.env.local`에 `VITE_API_URL`(백엔드 URL)을 설정합니다.

## API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/cycle-comparison` | 사이클 비교 차트 + C4 예측 |
| GET | `/api/bear-boxes?cycle=4` | Bear 박스권 + 라인 + 예측 |
| GET | `/api/bull-boxes?cycle=3` | Bull 박스권 + 라인 |
| GET | `/api/bear-prediction?cycle=4` | Bear 예측만 |
| GET | `/api/ohlcv` | OHLCV 캔들 데이터 |
| GET | `/api/cycle-data?max_days=400` | 원시 데이터 |
| GET | `/api/config` | 설정값 조회 |
| GET | `/health` | 헬스 체크 |

## Render 배포

1. Render 대시보드에서 **New Web Service** 생성
2. Repository 연결 → root directory를 `02_backend`로 설정
3. Environment:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Environment Variables에 `SUPABASE_URL`, `SUPABASE_KEY` 추가
5. Deploy!

배포 후 `01_frontend/`의 `.env.local`에서 `VITE_API_URL`을 Render URL로 변경:
```
VITE_API_URL=https://btc-cycle-api.onrender.com
```

## Frontend에서 삭제된 것들

마이그레이션으로 Frontend에서 제거된 파일/코드:

| 제거 대상 | 대체 |
|-----------|------|
| `src/lib/supabase.js` | `src/lib/api.js` |
| `src/utils/chartData.js` (대부분) | Backend services/* |
| `bottom_trend.mjs` | Backend 내부 로직 |
| `calc_pred.mjs` | Backend prediction.py |
| `predict_chart.mjs` | Backend prediction.py |
| `predict_result.json` | API 응답으로 대체 |
