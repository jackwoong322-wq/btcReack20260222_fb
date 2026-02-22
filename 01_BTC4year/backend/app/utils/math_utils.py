"""
수학/통계 유틸리티
- exponential_smooth: 지수 평활 (ES)
- find_most_similar_cycle: MSE 기반 유사 사이클 탐색
"""
import math
from typing import List, Dict, Any


def exponential_smooth(values: List[float], alpha: float = 0.4) -> Dict[str, Any]:
    """
    지수 평활 (Exponential Smoothing)

    values = [cycle1값, cycle2값, cycle3값]  — 오래된 것부터 순서대로
    가중치: 최신 데이터에 alpha, 그 이전에 alpha*(1-alpha), ...

    Returns:
        {"predicted": float, "sigma": float}
    """
    n = len(values)
    if n == 0:
        return {"predicted": 0, "sigma": 0}
    if n == 1:
        return {"predicted": values[0], "sigma": 0}

    # 가중치 계산: values[-1] = 최신
    weights = [alpha * ((1 - alpha) ** (n - 1 - i)) for i in range(n)]
    weight_sum = sum(weights)
    norm_weights = [w / weight_sum for w in weights]

    # 가중 평균 = 예측값
    predicted = sum(v * w for v, w in zip(values, norm_weights))

    # 가중 표준편차
    variance = sum(w * (v - predicted) ** 2 for v, w in zip(values, norm_weights))
    sigma = math.sqrt(variance)

    return {"predicted": predicted, "sigma": sigma}


def find_most_similar_cycle(
    all_cycle_boxes: Dict[int, list],
    cycle4_boxes: list,
) -> Dict[str, Any]:
    """
    Cycle 4의 실제 박스(n개)와 Cycle 1~3의 첫 n개 박스 패턴을 비교
    dropRatio / riseRatio의 MSE(평균제곱오차)가 가장 작은 사이클 반환
    """
    if not cycle4_boxes:
        return {"cycleNum": 3, "mse": float("inf")}

    n = len(cycle4_boxes)

    # Cycle 4 실제 비율
    c4_drops = []
    c4_rises = []
    for idx, box in enumerate(cycle4_boxes):
        prev_peak = 100 if idx == 0 else cycle4_boxes[idx - 1]["Peak_Rate"]
        c4_drops.append((prev_peak - box["Start_Rate"]) / prev_peak * 100)
        c4_rises.append(
            (box["Peak_Rate"] - box["Start_Rate"]) / box["Start_Rate"] * 100
        )

    best_cycle = 3
    best_mse = float("inf")

    for cn in [1, 2, 3]:
        boxes = all_cycle_boxes.get(cn, [])
        if len(boxes) < n:
            continue

        mse = 0
        for i in range(n):
            prev_peak = 100 if i == 0 else boxes[i - 1]["Peak_Rate"]
            drop = (prev_peak - boxes[i]["Start_Rate"]) / prev_peak * 100
            rise = (
                (boxes[i]["Peak_Rate"] - boxes[i]["Start_Rate"])
                / boxes[i]["Start_Rate"]
                * 100
            )
            mse += (drop - c4_drops[i]) ** 2 + (rise - c4_rises[i]) ** 2
        mse /= n

        if mse < best_mse:
            best_mse = mse
            best_cycle = cn

    return {"cycleNum": best_cycle, "mse": best_mse}
