"""
설정값 관리
- BEAR_CONFIG, BULL_CONFIG: 박스권 계산 파라미터
- Supabase 테이블명, 색상 등
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ── Supabase ───────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")  # service_role key (서버 전용)

# ── 테이블 ─────────────────────────────────────────────
CYCLE_TABLE_NAME = os.getenv("CYCLE_TABLE_NAME", "alt_cycle_data")
CYCLE_COIN_ID = os.getenv("CYCLE_COIN_ID", "bitcoin")
OHLCV_TABLE_NAME = os.getenv("OHLCV_TABLE_NAME", "ohlcv")
OHLCV_COIN_ID = os.getenv("OHLCV_COIN_ID", "bitcoin")

# ── Bear (하락장) 설정 ─────────────────────────────────
BEAR_CONFIG = {
    "RISE_THRESHOLD": 5.0,
    "BREAK_THRESHOLD": 2.0,
    "MIN_DURATION_DAYS": 1,
    "MAX_DURATION_DAYS": 400,
    "MIN_DROP_FROM_PREV_HIGH": 3.0,
}

# ── Bull (상승장) 설정 ─────────────────────────────────
BULL_CONFIG = {
    "MIN_DAYS_FROM_PEAK": 400,
    "MAX_DAYS_FROM_PEAK": 1450,
    "DROP_THRESHOLD": 5.0,
    "BREAK_THRESHOLD": 2.0,
    "MIN_DURATION_DAYS": 1,
    "LOOKBACK_DAYS": 10,
}

# ── 차트 색상 (API 응답에 포함) ────────────────────────
COLORS = [
    "#3B82F6", "#10B981", "#EF4444", "#F59E0B",
    "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16",
]

COLOR_NAMES = [
    "blue", "green", "red", "orange",
    "purple", "pink", "cyan", "lime",
]
