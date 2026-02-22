"""
사이클 관련 API 엔드포인트

GET /api/cycle-data          — 원시 사이클 데이터
GET /api/cycle-comparison    — 사이클 비교 시리즈
GET /api/bear-boxes          — Bear 박스권 + 라인 데이터 + 예측
GET /api/bull-boxes          — Bull 박스권 + 라인 데이터
GET /api/bear-prediction     — Bear 예측만 별도 조회
GET /api/config              — 현재 설정값
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from app.config import BEAR_CONFIG, BULL_CONFIG, COLORS, COLOR_NAMES
from app.services.cycle_data import (
    fetch_cycle_data,
    group_by_cycle,
    create_cycle_comparison_series,
    create_bear_line_data,
    create_bull_line_data,
)
from app.services.bear_box import calculate_bear_boxes
from app.services.bull_box import calculate_bull_boxes
from app.services.prediction import calculate_bear_prediction

router = APIRouter()


@router.get("/cycle-data")
async def get_cycle_data(
    max_days: Optional[int] = Query(None, description="최대 일수 필터"),
    min_days: Optional[int] = Query(None, description="최소 일수 필터"),
):
    """원시 사이클 데이터 조회"""
    try:
        data = fetch_cycle_data(max_days=max_days, min_days=min_days)
        if not data:
            raise HTTPException(status_code=404, detail="데이터를 찾을 수 없습니다.")
        return {"data": data, "count": len(data)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cycle-comparison")
async def get_cycle_comparison():
    """사이클 비교 차트 데이터 + Cycle4 예측"""
    try:
        # 전체 데이터 조회
        data = fetch_cycle_data()
        if not data:
            raise HTTPException(status_code=404, detail="데이터를 찾을 수 없습니다.")

        cycles = group_by_cycle(data)
        series = create_cycle_comparison_series(cycles)
        max_days = max(d["days_since_peak"] for d in data) if data else 0

        # Cycle 4 예측 계산
        predictions = []
        bear_data = fetch_cycle_data(max_days=BEAR_CONFIG["MAX_DURATION_DAYS"])
        if bear_data:
            bear_cycles = group_by_cycle(bear_data)
            all_cycle_boxes = {}
            for cn in [1, 2, 3]:
                if cn in bear_cycles:
                    all_cycle_boxes[cn] = calculate_bear_boxes(bear_cycles[cn], cn)

            cycle4_data = bear_cycles.get(4, [])
            cycle4_boxes = calculate_bear_boxes(cycle4_data, 4)
            cycle4_line = create_bear_line_data(cycle4_data, cycle4_boxes)
            predictions = calculate_bear_prediction(
                all_cycle_boxes, cycle4_boxes, cycle4_line
            )

        return {
            "series": series,
            "predictions": predictions,
            "maxDays": max_days,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/bear-boxes")
async def get_bear_boxes(
    cycle: int = Query(4, ge=1, le=4, description="사이클 번호"),
):
    """Bear 박스권 + 라인 데이터 + 예측 (cycle 4)"""
    try:
        data = fetch_cycle_data(max_days=BEAR_CONFIG["MAX_DURATION_DAYS"])
        if not data:
            raise HTTPException(status_code=404, detail="데이터를 찾을 수 없습니다.")

        cycles = group_by_cycle(data)
        cycle_data = cycles.get(cycle, [])

        if not cycle_data:
            raise HTTPException(
                status_code=404,
                detail=f"사이클 {cycle} 데이터를 찾을 수 없습니다.",
            )

        boxes = calculate_bear_boxes(cycle_data, cycle)
        line_data = create_bear_line_data(cycle_data, boxes)

        # 사이클 정보
        cycle_info = {
            "startDate": "",
            "endDate": "",
        }
        if cycle_data:
            from app.services.cycle_data import format_date

            first_ts = cycle_data[0].get("timestamp", "")
            last_ts = cycle_data[-1].get("timestamp", "")
            cycle_info["startDate"] = format_date(first_ts)[:7].replace("-", ".")
            cycle_info["endDate"] = format_date(last_ts)[:7].replace("-", ".")

        # Cycle 4 전용 예측
        predictions = []
        if cycle == 4:
            all_cycle_boxes = {}
            for cn in [1, 2, 3]:
                if cn in cycles:
                    all_cycle_boxes[cn] = calculate_bear_boxes(cycles[cn], cn)
            predictions = calculate_bear_prediction(
                all_cycle_boxes, boxes, line_data
            )

        return {
            "lineData": line_data,
            "boxes": boxes,
            "predictions": predictions,
            "cycleInfo": cycle_info,
            "config": BEAR_CONFIG,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/bull-boxes")
async def get_bull_boxes(
    cycle: int = Query(3, ge=1, le=3, description="사이클 번호"),
):
    """Bull 박스권 + 라인 데이터"""
    try:
        data = fetch_cycle_data(
            max_days=BULL_CONFIG["MAX_DAYS_FROM_PEAK"],
            min_days=BULL_CONFIG["MIN_DAYS_FROM_PEAK"],
        )
        if not data:
            raise HTTPException(status_code=404, detail="데이터를 찾을 수 없습니다.")

        cycles = group_by_cycle(data)
        cycle_data = cycles.get(cycle, [])

        if not cycle_data:
            raise HTTPException(
                status_code=404,
                detail=f"사이클 {cycle} 데이터를 찾을 수 없습니다.",
            )

        boxes = calculate_bull_boxes(cycle_data, cycle)
        line_data = create_bull_line_data(cycle_data, boxes)
        max_days_val = max(d["day"] for d in cycle_data) if cycle_data else 0

        # 사이클 정보
        cycle_info = {"startDate": "", "endDate": "", "maxDays": max_days_val}
        if cycle_data:
            from app.services.cycle_data import format_date

            first_ts = cycle_data[0].get("timestamp", "")
            last_ts = cycle_data[-1].get("timestamp", "")
            cycle_info["startDate"] = format_date(first_ts)[:7].replace("-", ".")
            cycle_info["endDate"] = format_date(last_ts)[:7].replace("-", ".")

        return {
            "lineData": line_data,
            "boxes": boxes,
            "cycleInfo": cycle_info,
            "config": BULL_CONFIG,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/bear-prediction")
async def get_bear_prediction(
    cycle: int = Query(4, description="사이클 번호 (4만 지원)"),
):
    """Bear 예측만 별도 조회"""
    if cycle != 4:
        return {"predictions": []}

    try:
        data = fetch_cycle_data(max_days=BEAR_CONFIG["MAX_DURATION_DAYS"])
        if not data:
            raise HTTPException(status_code=404, detail="데이터를 찾을 수 없습니다.")

        cycles = group_by_cycle(data)

        all_cycle_boxes = {}
        for cn in [1, 2, 3]:
            if cn in cycles:
                all_cycle_boxes[cn] = calculate_bear_boxes(cycles[cn], cn)

        cycle4_data = cycles.get(4, [])
        cycle4_boxes = calculate_bear_boxes(cycle4_data, 4)
        cycle4_line = create_bear_line_data(cycle4_data, cycle4_boxes)

        predictions = calculate_bear_prediction(
            all_cycle_boxes, cycle4_boxes, cycle4_line
        )

        return {"predictions": predictions}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config")
async def get_config():
    """현재 설정값 조회"""
    return {
        "bearConfig": BEAR_CONFIG,
        "bullConfig": BULL_CONFIG,
        "colors": COLORS,
        "colorNames": COLOR_NAMES,
    }
