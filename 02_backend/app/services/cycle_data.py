"""
사이클 데이터 조회 및 가공 서비스
- fetch_cycle_data: Supabase에서 데이터 조회
- group_by_cycle: 사이클별 그룹핑
- create_cycle_comparison_series: 사이클 비교 시리즈 생성
- create_bear_line_data / create_bull_line_data: 라인 차트 데이터
"""
from typing import Optional, List, Dict, Any
from app.db import get_supabase
from datetime import datetime, timezone

from app.config import (
    CYCLE_TABLE_NAME,
    CYCLE_COIN_ID,
    OHLCV_TABLE_NAME,
    OHLCV_COIN_ID,
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
            .eq("coin_id", CYCLE_COIN_ID)
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


def _ohlcv_row_to_chart_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    """public.ohlcv 행 → 프론트(TradingChart)가 기대하는 필드."""
    date_str = str(row.get("date", ""))[:10]
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    ts_ms = int(dt.timestamp() * 1000)
    vol = row.get("volume_base") or 0
    return {
        "timestamp": ts_ms,
        "readable_time": f"{date_str}T00:00:00.000Z",
        "open": float(row["open"]),
        "high": float(row["high"]),
        "low": float(row["low"]),
        "close": float(row["close"]),
        "volume": float(vol),
    }


def fetch_ohlcv_data() -> List[Dict[str, Any]]:
    """Supabase public.ohlcv 조회 후 트레이딩 차트용 JSON 형태로 변환."""
    supabase = get_supabase()
    all_data: List[Dict[str, Any]] = []
    offset = 0
    batch_size = 1000

    while True:
        response = (
            supabase.table(OHLCV_TABLE_NAME)
            .select("date, open, high, low, close, volume_base")
            .eq("coin_id", OHLCV_COIN_ID)
            .order("date", desc=False)
            .range(offset, offset + batch_size - 1)
            .execute()
        )

        data = response.data or []
        if not data:
            break

        all_data.extend(_ohlcv_row_to_chart_dict(r) for r in data)

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


def _parse_distinct_cycle_rpc_data(data: Any) -> Optional[List[int]]:
    """RPC distinct_cycle_numbers_for_coin 응답 → 정수 리스트. 형식 불명이면 None."""
    if data is None:
        return None
    if not isinstance(data, list):
        return None
    if not data:
        return []
    try:
        if isinstance(data[0], dict) and "cycle_number" in data[0]:
            return sorted(int(r["cycle_number"]) for r in data)
        if isinstance(data[0], int):
            return sorted(int(x) for x in data)
    except (TypeError, KeyError, ValueError):
        return None
    return None


def _fetch_distinct_cycle_numbers_paginated() -> List[int]:
    """전 행 페이지 스캔으로 distinct (RPC 미설치·다른 테이블명 시 폴백).

    PostgREST range()는 ORDER BY 없이 쓰면 비결정적이라, 고정 정렬 후 훑는다.
    """
    supabase = get_supabase()
    seen: set = set()
    offset = 0
    batch_size = 2000

    while True:
        response = (
            supabase.table(CYCLE_TABLE_NAME)
            .select("cycle_number")
            .eq("coin_id", CYCLE_COIN_ID)
            .order("days_since_peak", desc=False)
            .order("cycle_number", desc=False)
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break
        for row in rows:
            seen.add(int(row["cycle_number"]))
        if len(rows) < batch_size:
            break
        offset += batch_size

    return sorted(seen)


def fetch_distinct_cycle_numbers() -> List[int]:
    """coin_id 기준으로 DB에 존재하는 사이클 번호 목록 (오름차순).

    1) Supabase에 `distinct_cycle_numbers_for_coin` RPC가 있으면 한 번의 DISTINCT 쿼리로 조회.
    2) 없거나 실패 시 페이지 스캔 폴백 (테이블명이 alt_cycle_data가 아니면 항상 폴백).
    """
    supabase = get_supabase()
    rpc_numbers: Optional[List[int]] = None
    if CYCLE_TABLE_NAME == "alt_cycle_data":
        try:
            res = supabase.rpc(
                "distinct_cycle_numbers_for_coin",
                {"p_coin_id": CYCLE_COIN_ID},
            ).execute()
            rpc_numbers = _parse_distinct_cycle_rpc_data(res.data)
        except Exception:
            rpc_numbers = None

    paginated_numbers = _fetch_distinct_cycle_numbers_paginated()
    if rpc_numbers is None:
        return paginated_numbers
    return sorted(set(rpc_numbers) | set(paginated_numbers))


def fetch_cycle_peak_labels(cycle_numbers: List[int]) -> Dict[int, str]:
    """각 사이클의 피크일(days_since_peak=0) 행으로 메뉴 라벨 생성."""
    if not cycle_numbers:
        return {}
    supabase = get_supabase()
    labels: Dict[int, str] = {}

    for n in cycle_numbers:
        r = (
            supabase.table(CYCLE_TABLE_NAME)
            .select("cycle_name,timestamp")
            .eq("coin_id", CYCLE_COIN_ID)
            .eq("cycle_number", n)
            .eq("days_since_peak", 0)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0]
        if not row:
            labels[n] = f"Cycle {n}"
        elif row.get("cycle_name"):
            labels[n] = str(row["cycle_name"]).strip()
        else:
            ts = format_date(row.get("timestamp"))
            ym = ts[:7] if ts else ""
            labels[n] = f"Cycle {n}" + (f" ({ym})" if ym else "")

    return labels


def build_cycle_menu_payload() -> Dict[str, Any]:
    """사이드바 Bear/Bull 메뉴용 JSON."""
    nums = fetch_distinct_cycle_numbers()
    if not nums:
        return {"bearCycles": [], "bullCycles": [], "maxCycle": None}

    labels = fetch_cycle_peak_labels(nums)
    max_n = max(nums)
    items = [
        {
            "number": n,
            "label": labels.get(n, f"Cycle {n}"),
            "current": n == max_n,
        }
        for n in nums
    ]
    return {"bearCycles": items, "bullCycles": items, "maxCycle": max_n}


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
