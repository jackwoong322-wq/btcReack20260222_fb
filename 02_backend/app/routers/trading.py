"""
트레이딩 차트용 API 엔드포인트

GET /api/ohlcv — OHLCV 캔들 데이터
"""
from fastapi import APIRouter, HTTPException

from app.services.cycle_data import fetch_ohlcv_data

router = APIRouter()


@router.get("/ohlcv")
async def get_ohlcv():
    """OHLCV 데이터 조회 (트레이딩 차트용)"""
    try:
        data = fetch_ohlcv_data()
        if not data:
            raise HTTPException(status_code=404, detail="OHLCV 데이터 없음")
        return {"data": data, "count": len(data)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
