"""
Bitcoin Cycle Analyzer FastAPI Backend.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import cycle, trading

app = FastAPI(
    title="Bitcoin Cycle Analyzer API",
    version="1.0.0",
    description="BTC 4-year cycle analysis API",
)

# Configure CORS for local development, the production Vercel domain,
# and Vercel preview deployments used during testing/review.
ALLOWED_ORIGINS = (
    os.getenv("ALLOWED_ORIGINS", "").split(",")
    if os.getenv("ALLOWED_ORIGINS")
    else []
)

default_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://btc-reack20260222-fb.vercel.app",
]

all_origins = default_origins + [
    origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()
]

_LOCAL_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
_VERCEL_PREVIEW_REGEX = (
    r"^https://btc-reack20260222-[a-z0-9-]+-woongs-projects-[a-z0-9]+\.vercel\.app$"
)
_ALLOWED_ORIGIN_REGEX = f"{_LOCAL_ORIGIN_REGEX}|{_VERCEL_PREVIEW_REGEX}"

app.add_middleware(
    CORSMiddleware,
    allow_origins=all_origins,
    allow_origin_regex=_ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cycle.router, prefix="/api", tags=["cycle"])
app.include_router(trading.router, prefix="/api", tags=["trading"])


@app.get("/")
async def root():
    return {"status": "ok", "message": "Bitcoin Cycle Analyzer API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
