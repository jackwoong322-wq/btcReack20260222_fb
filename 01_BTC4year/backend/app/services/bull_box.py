"""
Bull 박스권 계산 서비스
Frontend chartData.js의 calculateBullBoxes 로직을 Python으로 마이그레이션
"""
from typing import List, Dict, Any, Optional, Tuple
from app.config import BULL_CONFIG, COLORS


# ─── 내부 함수들 ──────────────────────────────────────


def _is_significant_high(
    cycle_data: List[Dict], idx: int, lookback: int
) -> bool:
    """주변 범위 내 유의미한 고점인지 확인"""
    if idx < lookback:
        return False

    current = cycle_data[idx]["highRate"]
    start = max(0, idx - lookback)
    end = min(len(cycle_data), idx + lookback + 1)

    range_max = max(d["highRate"] for d in cycle_data[start:end])
    return current >= range_max


def _find_drop_low(
    cycle_data: List[Dict],
    start_idx: int,
    local_high: float,
    config: Dict,
) -> Tuple[bool, float, int]:
    """하락 저점 찾기"""
    temp_min = local_high
    temp_min_idx = start_idx

    for j in range(start_idx + 1, len(cycle_data)):
        current_low = cycle_data[j]["lowRate"]
        if current_low < temp_min:
            temp_min = current_low
            temp_min_idx = j
        if (local_high - temp_min) >= config["DROP_THRESHOLD"]:
            return True, temp_min, temp_min_idx

    return False, temp_min, temp_min_idx


def _find_bull_box_end(
    cycle_data: List[Dict],
    local_high_idx: int,
    local_high: float,
    start_search_idx: int,
    temp_min: float,
    temp_min_idx: int,
    config: Dict,
) -> Tuple[int, bool, float, int]:
    """Bull 박스 종료 지점 찾기"""
    break_threshold = local_high + (local_high * config["BREAK_THRESHOLD"] / 100)

    box_end_idx = start_search_idx
    box_broken = False
    min_low = temp_min
    min_idx = temp_min_idx

    for k in range(start_search_idx + 1, len(cycle_data)):
        check_high = cycle_data[k]["highRate"]
        current_low = cycle_data[k]["lowRate"]

        if check_high >= break_threshold:
            box_end_idx = k
            box_broken = True
            break

        if current_low < min_low:
            min_low = current_low
            min_idx = k
        box_end_idx = k

    if not box_broken:
        box_end_idx = len(cycle_data) - 1
        box_broken = True

    return box_end_idx, box_broken, min_low, min_idx


# ─── 메인 함수 ────────────────────────────────────────


def calculate_bull_boxes(
    cycle_data: List[Dict],
    cycle_num: int,
    config: Optional[Dict] = None,
) -> List[Dict[str, Any]]:
    """
    Bull 박스권 계산

    Args:
        cycle_data: [{"day": int, "timestamp": str, "closeRate": float,
                       "lowRate": float, "highRate": float}, ...]
        cycle_num: 사이클 번호
        config: BULL_CONFIG override (optional)

    Returns:
        박스 목록
    """
    if config is None:
        config = BULL_CONFIG

    min_days = config["MIN_DAYS_FROM_PEAK"]
    max_days = config.get("MAX_DAYS_FROM_PEAK", float("inf"))

    filtered = [
        d
        for d in cycle_data
        if d["day"] >= min_days and d["day"] <= max_days
    ]

    if len(filtered) < 20:
        return []

    boxes: List[Dict] = []
    box_id = 0
    i = config["LOOKBACK_DAYS"]

    while i < len(filtered):
        # 1) 유의미한 고점인지 확인
        if not _is_significant_high(filtered, i, config["LOOKBACK_DAYS"]):
            i += 1
            continue

        local_high = filtered[i]["highRate"]
        local_high_idx = i

        # 2) 하락 저점 찾기
        achieved, temp_min, temp_min_idx = _find_drop_low(
            filtered, i, local_high, config
        )
        if not achieved:
            i += 1
            continue

        # 3) 박스 종료 지점 찾기
        box_end_idx, box_broken, min_low, min_idx = _find_bull_box_end(
            filtered, local_high_idx, local_high,
            temp_min_idx, temp_min, temp_min_idx, config,
        )

        # 4) 최저점이 박스 범위 밖이면 재조정
        if min_idx > box_end_idx:
            sliced = filtered[local_high_idx : box_end_idx + 1]
            if sliced:
                min_low = min(d["lowRate"] for d in sliced)
                min_low_offset = next(
                    j for j, d in enumerate(sliced) if d["lowRate"] == min_low
                )
                min_idx = local_high_idx + min_low_offset

        # 5) 최소 기간 확인
        box_duration = filtered[box_end_idx]["day"] - filtered[local_high_idx]["day"]
        if box_duration < config["MIN_DURATION_DAYS"]:
            i = box_end_idx + 1
            continue

        box_id += 1
        boxes.append(
            {
                "Cycle": cycle_num,
                "Box_ID": box_id,
                "Start_Day": filtered[local_high_idx]["day"],
                "Start_Timestamp": filtered[local_high_idx]["timestamp"],
                "Start_Rate": round(local_high * 100) / 100,
                "Low_Day": filtered[min_idx]["day"],
                "Low_Timestamp": filtered[min_idx]["timestamp"],
                "Low_Rate": round(min_low * 100) / 100,
                "End_Day": filtered[box_end_idx]["day"],
                "End_Timestamp": filtered[box_end_idx]["timestamp"],
                "End_Rate": round(filtered[box_end_idx]["highRate"] * 100) / 100,
                "Drop_Percent": round((local_high - min_low) * 100) / 100,
                "Duration_Days": box_duration,
                "Box_Broken": box_broken,
                "color": COLORS[(box_id - 1) % len(COLORS)],
            }
        )

        i = box_end_idx + 1

    return boxes
