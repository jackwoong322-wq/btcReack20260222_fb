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
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://*.vercel.app",     # Vercel 배포 시
        "https://*.netlify.app",    # Netlify 배포 시
        # TODO: 실제 프론트엔드 도메인 추가
    ],
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
