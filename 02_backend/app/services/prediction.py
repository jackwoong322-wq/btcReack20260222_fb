"""
Bear 예측 서비스
Frontend chartData.js의 calculateBearPrediction 로직을 Python으로 마이그레이션

방법:
- 지수 평활 (ES) 기반 C1~C3 → C4 예측
- 유사 사이클 찾기 → alpha 조정
- 절대 앵커 방식 (오차 누적 방지)
- ±1σ 밴드 (낙관/비관)
- 클램핑 (C4 최저점 하한 보장)
"""
import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from app.config import BEAR_CONFIG
from app.utils.math_utils import exponential_smooth, find_most_similar_cycle


def calculate_bear_prediction(
    all_cycle_boxes: Dict[int, List[Dict]],
    current_cycle_boxes: List[Dict],
    current_cycle_line: List[Dict],
    *,
    ref_cycles: List[int],
) -> List[Dict[str, Any]]:
    """
    ref_cycles(보통 직전 3개 사이클)의 박스 패턴을 분석하여 현재(최신) 사이클 이후 예측 박스 생성

    Args:
        all_cycle_boxes: {사이클번호: 박스 목록} — ref_cycles 키만 사용
        current_cycle_boxes: 예측 대상 사이클의 실제 박스(현재까지)
        current_cycle_line: lineData (타임스탬프 참조용, 호환 유지)
        ref_cycles: 참조 사이클 번호 오래된 순 (예: [2,3,4] → 최신 가중 ES)

    Returns:
        예측 박스 배열
    """
    if not ref_cycles:
        return []

    # ── 박스 번호별 사이클별 상대 변화율 수집 ──────────
    stats_by_box_num: Dict[int, Dict] = {}
    for cn in ref_cycles:
        boxes = all_cycle_boxes.get(cn, [])
        for idx, box in enumerate(boxes):
            n = idx + 1
            if n not in stats_by_box_num:
                stats_by_box_num[n] = {
                    "dropByCycle": {},
                    "riseByCycle": {},
                    "durByCycle": {},
                }
            prev_peak = 100 if idx == 0 else boxes[idx - 1]["Peak_Rate"]
            stats_by_box_num[n]["dropByCycle"][cn] = (
                (prev_peak - box["Start_Rate"]) / prev_peak * 100
            )
            stats_by_box_num[n]["riseByCycle"][cn] = (
                (box["Peak_Rate"] - box["Start_Rate"]) / box["Start_Rate"] * 100
            )
            stats_by_box_num[n]["durByCycle"][cn] = box["Duration_Days"]

    # ── [개선①] 박스 수 ES 예측 ──────────────────────
    box_counts = [len(all_cycle_boxes.get(cn, [])) for cn in ref_cycles]
    box_count_es = exponential_smooth(box_counts)
    predicted_total_boxes = max(
        len(current_cycle_boxes) + 1,
        round(box_count_es["predicted"]),
    )

    # ── [개선②] 유사 사이클 → 가중치 조정 ────────────
    similar = find_most_similar_cycle(
        all_cycle_boxes, current_cycle_boxes, ref_cycles
    )
    similar_cycle = similar["cycleNum"]
    similar_alpha_map = {1: 0.28, 2: 0.40, 3: 0.55}
    adjusted_alpha = similar_alpha_map.get(similar_cycle, 0.4)

    # ── 절대 기준점 계산 ──────────────────────────────
    last_real_box = current_cycle_boxes[-1] if current_cycle_boxes else None
    if not last_real_box:
        return []

    # C1~C3 절대 저점 수집
    abs_base_by_box_num: Dict[int, List[float]] = {}
    for cn in ref_cycles:
        boxes = all_cycle_boxes.get(cn, [])
        for idx, box in enumerate(boxes):
            n = idx + 1
            if n not in abs_base_by_box_num:
                abs_base_by_box_num[n] = []
            abs_base_by_box_num[n].append(box["Start_Rate"])

    predictions: List[Dict] = []
    current_day = last_real_box["End_Day"]

    try:
        current_date = datetime.fromisoformat(
            last_real_box["End_Timestamp"].replace("Z", "+00:00")
        )
    except Exception:
        # timestamp가 "YYYY/MM/DD" 형식일 수 있음
        current_date = datetime.strptime(
            last_real_box["End_Timestamp"], "%Y/%m/%d"
        )

    # 체인 방식 fallback용
    prev_peak_chain = last_real_box["Peak_Rate"]
    prev_peak_hi_chain = last_real_box["Peak_Rate"]
    prev_peak_lo_chain = last_real_box["Peak_Rate"]

    start_box_num = len(current_cycle_boxes) + 1
    max_box_num = predicted_total_boxes
    max_duration_days = BEAR_CONFIG["MAX_DURATION_DAYS"]

    for n in range(start_box_num, 100):  # 400일 될 때까지
        stats = stats_by_box_num.get(n)
        if not stats:
            break

        drop_vals = [
            stats["dropByCycle"][cn]
            for cn in ref_cycles
            if cn in stats["dropByCycle"]
        ]
        rise_vals = [
            stats["riseByCycle"][cn]
            for cn in ref_cycles
            if cn in stats["riseByCycle"]
        ]
        dur_vals = [
            stats["durByCycle"][cn]
            for cn in ref_cycles
            if cn in stats["durByCycle"]
        ]

        if not drop_vals:
            break

        # [개선②] 유사 사이클 기반 adjustedAlpha 적용
        drop_reg = exponential_smooth(drop_vals, adjusted_alpha)
        rise_reg = exponential_smooth(rise_vals, adjusted_alpha)
        dur_reg = exponential_smooth(dur_vals, adjusted_alpha)

        pred_drop = max(0, drop_reg["predicted"])
        pred_rise = max(0, rise_reg["predicted"])
        pred_duration = max(5, round(dur_reg["predicted"]))

        # ±1σ 밴드
        drop_lo = max(0, pred_drop - drop_reg["sigma"])
        drop_hi = min(99, pred_drop + drop_reg["sigma"])
        rise_lo = max(0, pred_rise - rise_reg["sigma"])
        rise_hi = pred_rise + rise_reg["sigma"]

        # [개선③] 독립 앵커 계산
        abs_vals = abs_base_by_box_num.get(n, [])

        if len(abs_vals) >= 2:
            abs_es = exponential_smooth(abs_vals, adjusted_alpha)
            pred_start_rate = round(max(0, abs_es["predicted"]) * 100) / 100
            pred_peak_rate = round(
                pred_start_rate * (1 + pred_rise / 100) * 100
            ) / 100
        else:
            pred_start_rate = round(
                prev_peak_chain * (1 - pred_drop / 100) * 100
            ) / 100
            pred_peak_rate = round(
                pred_start_rate * (1 + pred_rise / 100) * 100
            ) / 100

        # [개선④] 클램핑
        CLAMP_CENTER_MIN = 30.0
        CLAMP_HI_MIN = 35.0
        CLAMP_LO_MIN = 28.0

        clamped_start_rate = max(pred_start_rate, CLAMP_CENTER_MIN)

        # 낙관 밴드
        pred_start_hi_raw = round(
            prev_peak_hi_chain * (1 - drop_lo / 100) * 100
        ) / 100
        pred_peak_hi = round(
            pred_start_hi_raw * (1 + rise_hi / 100) * 100
        ) / 100
        pred_start_hi = max(pred_start_hi_raw, CLAMP_HI_MIN)

        # 비관 밴드
        pred_start_lo_raw = round(
            prev_peak_lo_chain * (1 - drop_hi / 100) * 100
        ) / 100
        pred_peak_lo = round(
            pred_start_lo_raw * (1 + rise_lo / 100) * 100
        ) / 100
        pred_start_lo = max(pred_start_lo_raw, CLAMP_LO_MIN)

        # 날짜 계산
        box_start_date = current_date + timedelta(days=1)
        box_start_day = current_day + 1
        raw_end_day = box_start_day + pred_duration
        clamped_end_day = min(raw_end_day, max_duration_days)
        clamped_duration = clamped_end_day - box_start_day

        box_end_date = box_start_date + timedelta(days=clamped_duration)
        box_peak_date = box_start_date + timedelta(
            days=round(clamped_duration / 2)
        )

        predictions.append(
            {
                "Box_ID": n,
                "isPrediction": True,
                "similarCycle": similar_cycle,
                "adjustedAlpha": adjusted_alpha,
                "Start_Timestamp": box_start_date.isoformat(),
                "Start_Rate": clamped_start_rate,
                "Peak_Timestamp": box_peak_date.isoformat(),
                "Peak_Rate": pred_peak_rate,
                "End_Timestamp": box_end_date.isoformat(),
                "Duration_Days": clamped_duration,
                "Start_Rate_Hi": pred_start_hi,
                "Peak_Rate_Hi": pred_peak_hi,
                "Start_Rate_Lo": pred_start_lo,
                "Peak_Rate_Lo": pred_peak_lo,
                "refCycles": ref_cycles,
            }
        )

        # 체인 방식 업데이트
        prev_peak_chain = pred_peak_rate
        prev_peak_hi_chain = pred_peak_hi
        prev_peak_lo_chain = pred_peak_lo
        current_day += clamped_duration + 1
        current_date = box_end_date

        if current_day >= max_duration_days:
            break

    return predictions
