"""
Bear 박스권 계산 서비스
Frontend chartData.js의 calculateBearBoxes 로직을 Python으로 마이그레이션
"""
from typing import List, Dict, Any, Optional, Tuple
from app.config import BEAR_CONFIG, COLORS


# ─── 내부 함수들 ──────────────────────────────────────


def _find_true_low_before_rise(
    cycle_data: List[Dict],
    start_idx: int,
    config: Dict,
) -> Tuple[Optional[float], Optional[int]]:
    """상승 전 진정한 저점 찾기"""
    if start_idx >= len(cycle_data):
        return None, None

    min_low = cycle_data[start_idx]["lowRate"]
    min_low_idx = start_idx

    for j in range(start_idx, len(cycle_data)):
        current_low = cycle_data[j]["lowRate"]
        current_high = cycle_data[j]["highRate"]

        if current_low < min_low:
            min_low = current_low
            min_low_idx = j

        if j > min_low_idx and (current_high - min_low) >= config["RISE_THRESHOLD"]:
            return min_low, min_low_idx

    return None, None


def _find_rise_peak(
    cycle_data: List[Dict],
    start_idx: int,
    local_low: float,
    config: Dict,
) -> Tuple[bool, float, int]:
    """상승 피크 찾기"""
    temp_max = local_low
    temp_max_idx = start_idx

    for j in range(start_idx + 1, len(cycle_data)):
        current_high = cycle_data[j]["highRate"]
        if current_high > temp_max:
            temp_max = current_high
            temp_max_idx = j
        if (temp_max - local_low) >= config["RISE_THRESHOLD"]:
            return True, temp_max, temp_max_idx

    return False, temp_max, temp_max_idx


def _find_bear_box_end(
    cycle_data: List[Dict],
    local_low_idx: int,
    local_low: float,
    start_search_idx: int,
    temp_max: float,
    temp_max_idx: int,
    config: Dict,
) -> Tuple[int, bool, float, int]:
    """Bear 박스 종료 지점 찾기"""
    break_threshold = local_low - (local_low * config["BREAK_THRESHOLD"] / 100)
    max_search_idx = min(
        len(cycle_data), local_low_idx + config["MAX_DURATION_DAYS"]
    )

    box_end_idx = start_search_idx
    box_broken = False
    max_high = temp_max
    max_idx = temp_max_idx

    for k in range(start_search_idx + 1, max_search_idx):
        check_low = cycle_data[k]["lowRate"]
        current_high = cycle_data[k]["highRate"]

        if check_low <= break_threshold:
            box_end_idx = k
            box_broken = True
            break

        if current_high > max_high:
            max_high = current_high
            max_idx = k
        box_end_idx = k

    if not box_broken and box_end_idx >= max_search_idx - 1:
        box_broken = True

    return box_end_idx, box_broken, max_high, max_idx


# ─── 메인 함수 ────────────────────────────────────────


def calculate_bear_boxes(
    cycle_data: List[Dict],
    cycle_num: int,
    config: Optional[Dict] = None,
) -> List[Dict[str, Any]]:
    """
    Bear 박스권 계산

    Args:
        cycle_data: [{"day": int, "timestamp": str, "closeRate": float,
                       "lowRate": float, "highRate": float}, ...]
        cycle_num: 사이클 번호 (1~4)
        config: BEAR_CONFIG override (optional)

    Returns:
        박스 목록
    """
    if config is None:
        config = BEAR_CONFIG

    max_days = config["MAX_DURATION_DAYS"]
    filtered = [d for d in cycle_data if d["day"] <= max_days]

    if len(filtered) < 50:
        return []

    boxes: List[Dict] = []
    box_id = 0
    i = 1
    prev_box_high = 100

    while i < len(filtered):
        # 1) 진정한 저점 찾기
        local_low, local_low_idx = _find_true_low_before_rise(filtered, i, config)
        if local_low is None:
            break

        # 2) 이전 고점 대비 충분한 하락인지 확인
        drop_from_prev = prev_box_high - local_low
        if drop_from_prev < config["MIN_DROP_FROM_PREV_HIGH"]:
            i = local_low_idx + 1
            continue

        # 3) 상승 피크 찾기
        achieved, temp_max, temp_max_idx = _find_rise_peak(
            filtered, local_low_idx, local_low, config
        )
        if not achieved:
            i = local_low_idx + 1
            continue

        # 4) 박스 종료 지점 찾기
        box_end_idx, box_broken, max_high, max_idx = _find_bear_box_end(
            filtered, local_low_idx, local_low,
            temp_max_idx, temp_max, temp_max_idx, config,
        )

        # 5) 최고점이 박스 범위 밖이면 재조정
        if max_idx > box_end_idx:
            sliced = filtered[local_low_idx : box_end_idx + 1]
            if sliced:
                max_high = max(d["highRate"] for d in sliced)
                max_high_offset = next(
                    j for j, d in enumerate(sliced) if d["highRate"] == max_high
                )
                max_idx = local_low_idx + max_high_offset

        # 6) 최소 기간 확인
        box_duration = filtered[box_end_idx]["day"] - filtered[local_low_idx]["day"]
        if box_duration < config["MIN_DURATION_DAYS"]:
            i = box_end_idx + 1
            continue

        box_id += 1
        boxes.append(
            {
                "Cycle": cycle_num,
                "Box_ID": box_id,
                "Start_Day": filtered[local_low_idx]["day"],
                "Start_Timestamp": filtered[local_low_idx]["timestamp"],
                "Start_Rate": round(local_low * 100) / 100,
                "Peak_Day": filtered[max_idx]["day"],
                "Peak_Timestamp": filtered[max_idx]["timestamp"],
                "Peak_Rate": round(max_high * 100) / 100,
                "End_Day": filtered[box_end_idx]["day"],
                "End_Timestamp": filtered[box_end_idx]["timestamp"],
                "End_Rate": round(filtered[box_end_idx]["lowRate"] * 100) / 100,
                "Rise_Percent": round((max_high - local_low) * 100) / 100,
                "Duration_Days": box_duration,
                "Box_Broken": box_broken,
                "color": COLORS[(box_id - 1) % len(COLORS)],
            }
        )

        prev_box_high = max_high
        i = box_end_idx + 1

    return boxes
