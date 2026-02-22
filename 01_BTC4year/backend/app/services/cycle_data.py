"""
사이클 데이터 조회 및 가공 서비스
- fetch_cycle_data: Supabase에서 데이터 조회
- group_by_cycle: 사이클별 그룹핑
- create_cycle_comparison_series: 사이클 비교 시리즈 생성
- create_bear_line_data / create_bull_line_data: 라인 차트 데이터
"""
from typing import Optional, List, Dict, Any
from app.db import get_supabase
from app.config import (
    CYCLE_TABLE_NAME,
    OHLCV_TABLE_NAME,
    BEAR_CONFIG,
    BULL_CONFIG,
    COLORS,
    COLOR_NAMES,
)


# ─── 데이터 로딩 ──────────────────────────────────────


def fetch_cycle_data(
    max_days: Optional[int] = None,
    min_days: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Supabase에서 사이클 데이터 조회 (페이지네이션)"""
    supabase = get_supabase()
    all_data: List[Dict] = []
    offset = 0
    batch_size = 1000

    while True:
        query = (
            supabase.table(CYCLE_TABLE_NAME)
            .select(
                "cycle_number, days_since_peak, timestamp, "
                "close_rate, low_rate, high_rate"
            )
            .order("days_since_peak", desc=False)
            .order("cycle_number", desc=False)
            .range(offset, offset + batch_size - 1)
        )

        if max_days is not None:
            query = query.lte("days_since_peak", max_days)
        if min_days is not None:
            query = query.gte("days_since_peak", min_days)

        response = query.execute()
        data = response.data or []

        if not data:
            break

        all_data.extend(data)

        if len(data) < batch_size:
            break
        offset += batch_size

    return all_data


def fetch_ohlcv_data() -> List[Dict[str, Any]]:
    """Supabase에서 OHLCV 데이터 조회 (트레이딩 차트용)"""
    supabase = get_supabase()
    all_data: List[Dict] = []
    offset = 0
    batch_size = 1000

    while True:
        response = (
            supabase.table(OHLCV_TABLE_NAME)
            .select("timestamp, readable_time, open, high, low, close, volume")
            .order("timestamp", desc=False)
            .range(offset, offset + batch_size - 1)
            .execute()
        )

        data = response.data or []
        if not data:
            break

        all_data.extend(data)

        if len(data) < batch_size:
            break
        offset += batch_size

    return all_data


# ─── 데이터 가공 ──────────────────────────────────────


def group_by_cycle(data: List[Dict]) -> Dict[int, List[Dict]]:
    """사이클 번호별로 그룹핑"""
    cycles: Dict[int, list] = {}
    for row in data:
        cn = row["cycle_number"]
        if cn not in cycles:
            cycles[cn] = []
        cycles[cn].append(
            {
                "day": row["days_since_peak"],
                "timestamp": row["timestamp"],
                "closeRate": row["close_rate"],
                "lowRate": row["low_rate"],
                "highRate": row["high_rate"],
            }
        )
    return cycles


def format_date(timestamp: Optional[str]) -> str:
    """타임스탬프 → YYYY.MM.DD 포맷"""
    if not timestamp:
        return ""
    try:
        from datetime import datetime

        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return f"{dt.year}.{dt.month:02d}.{dt.day:02d}"
    except Exception:
        return str(timestamp)[:10].replace("-", ".")


def create_cycle_comparison_series(
    cycles: Dict[int, List[Dict]],
) -> List[Dict[str, Any]]:
    """사이클 비교 차트용 시리즈 데이터 생성"""
    series = []
    sorted_keys = sorted(cycles.keys(), key=int)

    for idx, cycle_num in enumerate(sorted_keys):
        cycle_data = cycles[cycle_num]
        if not cycle_data:
            continue

        start_date = format_date(cycle_data[0].get("timestamp"))
        end_date = format_date(cycle_data[-1].get("timestamp"))
        min_rate = min(d["closeRate"] for d in cycle_data)

        series.append(
            {
                "name": f"Cycle {cycle_num} : {start_date}",
                "data": [
                    {"x": d["day"], "y": round(d["closeRate"] * 100) / 100}
                    for d in cycle_data
                ],
                "startDate": start_date,
                "endDate": end_date,
                "dayCount": len(cycle_data),
                "minRate": round(min_rate * 100) / 100,
                "color": COLORS[idx % len(COLORS)],
                "colorName": COLOR_NAMES[idx % len(COLOR_NAMES)],
            }
        )

    return series


# ─── 라인 차트 데이터 ─────────────────────────────────


def create_bear_line_data(
    cycle_data: List[Dict], boxes: List[Dict]
) -> List[Dict[str, Any]]:
    """Bear 라인 차트용 데이터"""
    max_days = BEAR_CONFIG["MAX_DURATION_DAYS"]
    result = []

    for d in cycle_data:
        if d["day"] > max_days:
            continue

        current_box = None
        for box in boxes:
            if box["Start_Day"] <= d["day"] <= box["End_Day"]:
                current_box = box
                break

        box_day = (d["day"] - current_box["Start_Day"] + 1) if current_box else None

        prev_high = 100
        for box in boxes:
            if box["Peak_Day"] < d["day"]:
                prev_high = box["Peak_Rate"]

        result.append(
            {
                "day": d["day"],
                "timestamp": d["timestamp"],
                "timestampFormatted": format_date(d["timestamp"]),
                "value": round(d["lowRate"] * 100) / 100,
                "box_id": current_box["Box_ID"] if current_box else None,
                "box_day": box_day,
                "box_duration": (
                    current_box["Duration_Days"] if current_box else None
                ),
                "box_low": current_box["Start_Rate"] if current_box else None,
                "box_high": current_box["Peak_Rate"] if current_box else None,
                "prev_high": prev_high,
            }
        )

    return result


def create_bull_line_data(
    cycle_data: List[Dict], boxes: List[Dict]
) -> List[Dict[str, Any]]:
    """Bull 라인 차트용 데이터"""
    min_days = BULL_CONFIG["MIN_DAYS_FROM_PEAK"]
    max_days = BULL_CONFIG["MAX_DAYS_FROM_PEAK"]
    result = []

    for d in cycle_data:
        if d["day"] < min_days or d["day"] > max_days:
            continue

        current_box = None
        for box in boxes:
            if box["Start_Day"] <= d["day"] <= box["End_Day"]:
                current_box = box
                break

        box_day = (d["day"] - current_box["Start_Day"] + 1) if current_box else None

        prev_low = cycle_data[0].get("highRate", 100) if cycle_data else 100
        for box in boxes:
            if box["Low_Day"] < d["day"]:
                prev_low = box["Low_Rate"]

        result.append(
            {
                "day": d["day"],
                "timestamp": d["timestamp"],
                "timestampFormatted": format_date(d["timestamp"]),
                "value": round(d["highRate"] * 100) / 100,
                "box_id": current_box["Box_ID"] if current_box else None,
                "box_day": box_day,
                "box_duration": (
                    current_box["Duration_Days"] if current_box else None
                ),
                "box_high": current_box["Start_Rate"] if current_box else None,
                "box_low": current_box["Low_Rate"] if current_box else None,
                "prev_low": prev_low,
            }
        )

    return result
