"""
사이클 관련 API 엔드포인트

GET /api/cycle-data          — 원시 사이클 데이터
GET /api/cycle-comparison    — 사이클 비교 시리즈
GET /api/bear-boxes          — Bear 박스권 + 라인 데이터 + 예측
GET /api/bull-boxes          — Bull 박스권 + 라인 데이터
GET /api/bear-prediction     — Bear 예측만 별도 조회
GET /api/cycle-menu          — Bear/Bull 메뉴용 사이클 목록 (DB)
GET /api/config              — 현재 설정값
"""
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query

from app.config import (
    BEAR_CONFIG,
    BULL_CONFIG,
    COLORS,
    COLOR_NAMES,
    CYCLE_COIN_ID,
    CYCLE_TABLE_NAME,
)
from app.services.cycle_data import (
    fetch_cycle_data,
    group_by_cycle,
    create_cycle_comparison_series,
    create_bear_line_data,
    create_bull_line_data,
    build_cycle_menu_payload,
)
from app.services.bear_box import calculate_bear_boxes
from app.services.bull_box import calculate_bull_boxes
from app.services.prediction import calculate_bear_prediction

router = APIRouter()

_MAX_CYCLE_NUM = 99


def _bear_ref_cycles(cycle_nums: List[int], target: int) -> List[int]:
    """예측에 쓰는 참조 사이클: target보다 작은 번호 중 최대 3개(오래된 순)."""
    prior = sorted(c for c in cycle_nums if c < target)
    return prior[-3:] if prior else []


@router.get("/cycle-menu")
async def get_cycle_menu():
    """DB 기준 Bear/Bull 공통 사이클 목록 (메뉴 동적 구성용)."""
    try:
        return build_cycle_menu_payload()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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

        # 최신 Bear 사이클 예측 (참조: 직전 최대 3개 사이클)
        predictions = []
        bear_data = fetch_cycle_data(max_days=BEAR_CONFIG["MAX_DURATION_DAYS"])
        if bear_data:
            bear_cycles = group_by_cycle(bear_data)
            nums = sorted(bear_cycles.keys())
            if nums:
                max_cn = max(nums)
                ref = _bear_ref_cycles(nums, max_cn)
                if ref:
                    all_cycle_boxes = {
                        c: calculate_bear_boxes(bear_cycles[c], c) for c in ref
                    }
                    curr_boxes = calculate_bear_boxes(bear_cycles[max_cn], max_cn)
                    curr_line = create_bear_line_data(bear_cycles[max_cn], curr_boxes)
                    predictions = calculate_bear_prediction(
                        all_cycle_boxes,
                        curr_boxes,
                        curr_line,
                        ref_cycles=ref,
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
    cycle: int = Query(4, ge=1, le=_MAX_CYCLE_NUM, description="사이클 번호"),
):
    """Bear 박스권 + 라인 데이터 + 예측 (최신 사이클일 때만 예측 포함)"""
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

        predictions = []
        nums = sorted(cycles.keys())
        max_cn = max(nums) if nums else None
        if max_cn is not None and cycle == max_cn:
            ref = _bear_ref_cycles(nums, cycle)
            if ref:
                all_cycle_boxes = {
                    c: calculate_bear_boxes(cycles[c], c) for c in ref
                }
                predictions = calculate_bear_prediction(
                    all_cycle_boxes,
                    boxes,
                    line_data,
                    ref_cycles=ref,
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
    cycle: int = Query(3, ge=1, le=_MAX_CYCLE_NUM, description="사이클 번호"),
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
    cycle: int = Query(
        4, ge=1, le=_MAX_CYCLE_NUM, description="사이클 번호 (최신 사이클만 예측 반환)"
    ),
):
    """Bear 예측만 별도 조회 (DB상 최대 사이클 번호일 때만 비어 있지 않음)"""
    try:
        data = fetch_cycle_data(max_days=BEAR_CONFIG["MAX_DURATION_DAYS"])
        if not data:
            raise HTTPException(status_code=404, detail="데이터를 찾을 수 없습니다.")

        cycles = group_by_cycle(data)
        nums = sorted(cycles.keys())
        max_cn = max(nums) if nums else None
        if max_cn is None or cycle != max_cn:
            return {"predictions": []}

        ref = _bear_ref_cycles(nums, cycle)
        if not ref:
            return {"predictions": []}

        all_cycle_boxes = {c: calculate_bear_boxes(cycles[c], c) for c in ref}
        curr_boxes = calculate_bear_boxes(cycles[cycle], cycle)
        curr_line = create_bear_line_data(cycles[cycle], curr_boxes)

        predictions = calculate_bear_prediction(
            all_cycle_boxes, curr_boxes, curr_line, ref_cycles=ref
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
        "cycleCoinId": CYCLE_COIN_ID,
        "cycleTableName": CYCLE_TABLE_NAME,
    }
