"""
Bitcoin Cycle Analyzer — FastAPI Backend
Render 배포용
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import cycle, trading

app = FastAPI(
    title="Bitcoin Cycle Analyzer API",
    version="1.0.0",
    description="BTC 4년 주기 분석 API",
)

# ── CORS 설정 ──────────────────────────────────────────
# Render 배포 시 프론트엔드 도메인을 추가하세요
import os

# 환경변수로 CORS 허용 도메인 설정 (프로덕션)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "").split(",") if os.getenv("ALLOWED_ORIGINS") else []

# 기본 허용 도메인 (개발 + 프로덕션)
default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://btc-reack20260222-fb.vercel.app",  # Vercel 프론트엔드
]

# 환경변수에서 추가 도메인 병합
all_origins = default_origins + [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]

# 로컬 개발: 브라우저 Origin이 http://127.0.0.1:3000 vs http://localhost:3000 처럼 달라도 허용
# (목록만으로는 누락·캐시·구버전 프로세스 이슈가 있을 수 있어 정규식으로 보강)
_LOCAL_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=all_origins,
    allow_origin_regex=_LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 라우터 등록 ────────────────────────────────────────
app.include_router(cycle.router, prefix="/api", tags=["cycle"])
app.include_router(trading.router, prefix="/api", tags=["trading"])


@app.get("/")
async def root():
    return {"status": "ok", "message": "Bitcoin Cycle Analyzer API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
