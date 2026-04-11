"""
하락장 박스권 분석 (Supabase + ApexCharts 버전)
- 최고점에서 최저점까지의 하락 기간 내에서 반등 구간(박스권) 탐지
- 상승률 5% 이상 구간 식별 및 저점 재돌파 감지
"""

import os
import pandas as pd
import numpy as np
from datetime import datetime
import json
import time
from pathlib import Path
from supabase import create_client, Client
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_REPO_ROOT / "02_backend" / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# ==================== 설정 ====================
CYCLE_TABLE_NAME = os.getenv("CYCLE_TABLE_NAME", "alt_cycle_data")
CYCLE_COIN_ID = os.getenv("CYCLE_COIN_ID", "bitcoin")
OUTPUT_DIR = str(_REPO_ROOT / "01_frontend" / "public" / "charts")
RISE_THRESHOLD = 5.0  # 박스 인식을 위한 최소 상승률 (%)
BREAK_THRESHOLD = 2.0  # 박스 이탈 기준 (%)
MIN_DURATION_DAYS = 1  # 최소 박스 기간 (일)
MAX_DURATION_DAYS = 420  # 최대 분석 기간 (일)
MIN_DROP_FROM_PREV_HIGH = 3.0  # 이전 고점 대비 최소 하락률 (%) - 새 저점 인정 기준


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL과 SUPABASE_KEY 환경변수를 설정하세요")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def load_cycle_data_from_db():
    """Supabase에서 사이클 데이터를 불러와 Wide format으로 변환"""
    start_time = time.time()
    try:
        supabase = get_supabase_client()
        print("Supabase 연결 성공")

        all_data = []
        offset = 0
        batch_size = 1000

        while True:
            response = (
                supabase.table(CYCLE_TABLE_NAME)
                .select(
                    "cycle_number, days_since_peak, timestamp, close_price, low_price, high_price, close_rate, low_rate, high_rate"
                )
                .eq("coin_id", CYCLE_COIN_ID)
                .lte("days_since_peak", MAX_DURATION_DAYS)
                .order("days_since_peak", desc=False)
                .order("cycle_number", desc=False)
                .range(offset, offset + batch_size - 1)
                .execute()
            )

            if not response.data:
                break
            all_data.extend(response.data)
            if len(response.data) < batch_size:
                break
            offset += batch_size

        if not all_data:
            print("데이터베이스에서 사이클 데이터를 찾을 수 없습니다.")
            return None

        df = pd.DataFrame(all_data)

        result_df = df.pivot(
            index="days_since_peak",
            columns="cycle_number",
            values=[
                "timestamp",
                "close_price",
                "low_price",
                "high_price",
                "close_rate",
                "low_rate",
                "high_rate",
            ],
        )

        new_columns = []
        for col_type, cycle_num in result_df.columns:
            col_map = {
                "timestamp": f"{cycle_num}_timestamp",
                "close_price": f"{cycle_num}_close",
                "low_price": f"{cycle_num}_low",
                "high_price": f"{cycle_num}_high",
                "close_rate": f"{cycle_num}_rate",
                "low_rate": f"{cycle_num}_low_rate",
                "high_rate": f"{cycle_num}_high_rate",
            }
            new_columns.append(col_map.get(col_type, f"{cycle_num}_{col_type}"))

        result_df.columns = new_columns
        result_df.reset_index(inplace=True)
        result_df.rename(columns={"days_since_peak": "Days_Since_Peak"}, inplace=True)

        print(
            f"Supabase에서 {len(result_df)}개 행 로드 ({time.time() - start_time:.2f}초)"
        )
        return result_df

    except Exception as e:
        print(f"데이터 로드 오류: {e}")
        return None


def get_column_names(cycle_num):
    return {
        "rate": f"{cycle_num}_rate",
        "low_rate": f"{cycle_num}_low_rate",
        "high_rate": f"{cycle_num}_high_rate",
        "timestamp": f"{cycle_num}_timestamp",
        "low": f"{cycle_num}_low",
        "high": f"{cycle_num}_high",
    }


def validate_columns(cycle_data, cols, rate_col):
    low_rate_col = (
        cols["low_rate"] if cols["low_rate"] in cycle_data.columns else rate_col
    )
    high_rate_col = (
        cols["high_rate"] if cols["high_rate"] in cycle_data.columns else rate_col
    )
    return low_rate_col, high_rate_col


def find_rise_peak(cycle_data, start_idx, local_low, high_rate_col):
    """저점 이후 5% 상승하는 고점 찾기"""
    j = start_idx + 1
    temp_max = local_low
    temp_max_idx = start_idx

    while j < len(cycle_data):
        current_high = cycle_data.iloc[j][high_rate_col]
        if current_high > temp_max:
            temp_max = current_high
            temp_max_idx = j
        if temp_max - local_low >= RISE_THRESHOLD:
            return True, temp_max, temp_max_idx
        j += 1
    return False, temp_max, temp_max_idx


def find_box_end(
    cycle_data,
    local_low_idx,
    local_low,
    start_search_idx,
    temp_max,
    temp_max_idx,
    low_rate_col,
    high_rate_col,
):
    """박스 종료 지점 찾기 (저점 이탈 시)"""
    break_threshold = local_low - (local_low * BREAK_THRESHOLD / 100)
    max_search_idx = min(len(cycle_data), local_low_idx + MAX_DURATION_DAYS)

    k = start_search_idx + 1
    box_end_idx = start_search_idx
    box_broken = False
    max_high = temp_max
    max_idx = temp_max_idx

    while k < max_search_idx:
        check_low = cycle_data.iloc[k][low_rate_col]
        current_high = cycle_data.iloc[k][high_rate_col]

        if check_low <= break_threshold:
            box_end_idx = k
            box_broken = True
            break

        if current_high > max_high:
            max_high = current_high
            max_idx = k
        k += 1

    if not box_broken:
        box_end_idx = max_search_idx - 1 if k >= max_search_idx else len(cycle_data) - 1
        box_broken = k >= max_search_idx

    return box_end_idx, box_broken, max_high, max_idx


def create_box_info(
    box_id,
    cycle_num,
    cycle_data,
    local_low_idx,
    local_low,
    max_idx,
    max_high,
    box_end_idx,
    box_broken,
    cols,
):
    rise_pct = max_high - local_low
    return {
        "Cycle": cycle_num,
        "Box_ID": box_id,
        "Start_Day": int(cycle_data.iloc[local_low_idx]["Days_Since_Peak"]),
        "Start_Timestamp": cycle_data.iloc[local_low_idx][cols["timestamp"]],
        "Start_Rate": round(local_low, 2),
        "Peak_Day": int(cycle_data.iloc[max_idx]["Days_Since_Peak"]),
        "Peak_Timestamp": cycle_data.iloc[max_idx][cols["timestamp"]],
        "Peak_Rate": round(max_high, 2),
        "End_Day": int(cycle_data.iloc[box_end_idx]["Days_Since_Peak"]),
        "End_Timestamp": cycle_data.iloc[box_end_idx][cols["timestamp"]],
        "End_Rate": round(cycle_data.iloc[box_end_idx][cols["low_rate"]], 2),
        "Rise_Percent": round(rise_pct, 2),
        "Duration_Days": int(
            cycle_data.iloc[box_end_idx]["Days_Since_Peak"]
            - cycle_data.iloc[local_low_idx]["Days_Since_Peak"]
        ),
        "Box_Broken": box_broken,
    }


def find_true_low_before_rise(cycle_data, start_idx, low_rate_col, high_rate_col):
    """
    5% 상승이 발생하기 전까지의 '진짜 최저점'을 찾는다.

    핵심 로직:
    1. start_idx부터 순회하면서 최저점을 계속 갱신
    2. 최저점 이후의 날짜에서 5% 상승이 확인되면 그 최저점을 반환
    3. 새로운 더 낮은 저점이 나오면 최저점을 갱신하고, 5% 상승 체크 리셋
    """
    if start_idx >= len(cycle_data):
        return None, None

    min_low = cycle_data.iloc[start_idx][low_rate_col]
    min_low_idx = start_idx

    j = start_idx
    while j < len(cycle_data):
        current_low = cycle_data.iloc[j][low_rate_col]
        current_high = cycle_data.iloc[j][high_rate_col]

        # 더 낮은 저점 발견 → 최저점 갱신
        if current_low < min_low:
            min_low = current_low
            min_low_idx = j

        # 최저점 이후의 날짜에서만 5% 상승 체크
        # (최저점 당일은 체크하지 않음 - 같은 날 고점이 5% 높아도 그건 같은 캔들)
        if j > min_low_idx:
            if current_high - min_low >= RISE_THRESHOLD:
                # 5% 상승 확인! 현재 최저점이 진짜 저점
                return min_low, min_low_idx

        j += 1

    # 끝까지 갔는데 5% 상승이 없음
    return None, None


def find_box_ranges(cycle_data, cycle_num, rate_col):
    """박스권 탐지 메인 함수"""
    # 420일까지만 사용
    cycle_data = cycle_data[cycle_data["Days_Since_Peak"] <= MAX_DURATION_DAYS].copy()

    if len(cycle_data) < 50:
        return []

    cycle_data = cycle_data.reset_index(drop=True).copy()
    cols = get_column_names(cycle_num)
    low_rate_col, high_rate_col = validate_columns(cycle_data, cols, rate_col)

    boxes = []
    box_id = 0
    i = 1
    prev_box_high = 100  # 이전 박스의 고점 (첫 박스는 100%에서 시작)

    while i < len(cycle_data):
        # 1. 진짜 최저점 찾기 (5% 상승 전까지의 최저점)
        local_low, local_low_idx = find_true_low_before_rise(
            cycle_data, i, low_rate_col, high_rate_col
        )

        # 더 이상 유효한 저점 없음
        if local_low is None:
            break

        # 2. 이전 고점 대비 충분히 하락했는지 체크
        drop_from_prev_high = prev_box_high - local_low
        if drop_from_prev_high < MIN_DROP_FROM_PREV_HIGH:
            # 이전 고점에서 충분히 하락하지 않음 → 저점 이후부터 다시 탐색
            i = local_low_idx + 1
            continue

        # 3. 5% 상승 고점 찾기
        rise_achieved, temp_max, temp_max_idx = find_rise_peak(
            cycle_data, local_low_idx, local_low, high_rate_col
        )
        if not rise_achieved:
            i = local_low_idx + 1
            continue

        # 4. 박스 종료 지점 찾기
        box_end_idx, box_broken, max_high, max_idx = find_box_end(
            cycle_data,
            local_low_idx,
            local_low,
            temp_max_idx,
            temp_max,
            temp_max_idx,
            low_rate_col,
            high_rate_col,
        )

        # 고점 인덱스 보정
        if max_idx > box_end_idx:
            max_high = cycle_data.iloc[local_low_idx : box_end_idx + 1][
                high_rate_col
            ].max()
            max_idx = cycle_data.iloc[local_low_idx : box_end_idx + 1][
                high_rate_col
            ].idxmax()

        # 5. 최소 기간 체크
        box_duration = (
            cycle_data.iloc[box_end_idx]["Days_Since_Peak"]
            - cycle_data.iloc[local_low_idx]["Days_Since_Peak"]
        )
        if box_duration < MIN_DURATION_DAYS:
            i = box_end_idx + 1
            continue

        # 6. 박스 저장
        box_id += 1
        boxes.append(
            create_box_info(
                box_id,
                cycle_num,
                cycle_data,
                local_low_idx,
                local_low,
                max_idx,
                max_high,
                box_end_idx,
                box_broken,
                {**cols, "low_rate": low_rate_col},
            )
        )

        # 다음 박스 탐색을 위해 현재 박스의 고점 저장
        prev_box_high = max_high
        i = box_end_idx + 1

    print(f"   ✅ {len(boxes)}개 박스권 발견")
    return boxes


def visualize_boxes(df, boxes, cycle_num):
    """박스권을 ApexCharts로 시각화"""
    cols = get_column_names(cycle_num)
    cycle_data = df[df[cols["rate"]].notna()].copy()
    cycle_data = cycle_data[cycle_data["Days_Since_Peak"] <= MAX_DURATION_DAYS]
    if cycle_data.empty:
        return

    low_rate_col = (
        cols["low_rate"] if cols["low_rate"] in cycle_data.columns else cols["rate"]
    )

    # 라인 데이터 (timestamp 포함)
    line_data = []
    for _, row in cycle_data.iterrows():
        day = int(row["Days_Since_Peak"])
        rate = round(row[low_rate_col], 2)
        ts = row[cols["timestamp"]]
        try:
            date_str = pd.to_datetime(ts).strftime("%Y.%m.%d")
        except:
            date_str = str(ts)[:10]

        # 현재 day가 속한 박스 찾기
        current_box = None
        box_day = None
        for box in boxes:
            if box["Start_Day"] <= day <= box["End_Day"]:
                current_box = box
                box_day = day - box["Start_Day"] + 1
                break

        # 전고점 찾기 (현재 day 이전의 가장 가까운 고점)
        prev_high = 100
        for i, box in enumerate(boxes):
            if box["Peak_Day"] < day:
                prev_high = box["Peak_Rate"]
            elif box["Peak_Day"] >= day:
                break

        line_data.append(
            {
                "x": day,
                "y": rate,
                "timestamp": date_str,
                "box_id": current_box["Box_ID"] if current_box else None,
                "box_day": box_day,
                "box_duration": current_box["Duration_Days"] if current_box else None,
                "box_low": current_box["Start_Rate"] if current_box else None,
                "box_high": current_box["Peak_Rate"] if current_box else None,
                "prev_high": prev_high,
            }
        )

    # 박스 색상
    box_colors = [
        "#3B82F6",
        "#10B981",
        "#EF4444",
        "#F59E0B",
        "#8B5CF6",
        "#EC4899",
        "#06B6D4",
        "#84CC16",
    ]
    for idx, box in enumerate(boxes):
        box["color"] = box_colors[idx % len(box_colors)]

    # 시작 날짜
    first_timestamp = cycle_data.iloc[0][cols["timestamp"]]
    try:
        start_date = pd.to_datetime(first_timestamp).strftime("%Y.%m")
    except:
        start_date = str(first_timestamp)[:7]

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cycle {cycle_num} - Box Range Analysis</title>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        html {{ height: 100%; }}
        body {{ height: 100%; overflow-x: hidden; overflow-y: auto; }}
        body {{ font-family: 'Inter', sans-serif; background: linear-gradient(180deg, #020617 0%, #0F172A 100%); min-height: 100vh; padding: 20px; display: flex; flex-direction: column; }}
        .container {{ flex: 1; display: flex; flex-direction: column; max-width: 1400px; width: 100%; margin: 0 auto; min-height: 0; }}
        .chart-wrapper {{ flex: 1; display: flex; flex-direction: column; background: linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%); border-radius: 16px; padding: 20px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.05); min-height: 0; }}
        .header {{ flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 12px; }}
        .header h2 {{ font-size: 18px; font-weight: 700; color: #F8FAFC; }}
        .header p {{ font-size: 12px; color: #64748B; margin-top: 4px; }}
        #chart {{ flex: 1; margin: 0 -12px; min-height: 0; }}
        .footer {{ flex-shrink: 0; display: flex; justify-content: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #64748B; }}
        
        /* 모바일 대응 */
        @media (max-width: 768px) {{
            body {{ padding: 12px; }}
            .chart-wrapper {{ padding: 12px; border-radius: 12px; min-height: 450px; }}
            .header h2 {{ font-size: 14px; }}
            .header p {{ font-size: 10px; }}
            #chart {{ margin: 0 -6px; min-height: 350px; }}
            .footer {{ font-size: 9px; margin-top: 8px; padding-top: 8px; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="chart-wrapper">
            <div class="header">
                <div>
                    <h2>Cycle {cycle_num} ({start_date}~) - Box Range Analysis</h2>
                    <p>Rise ≥{RISE_THRESHOLD}%, Break &lt;{BREAK_THRESHOLD}%</p>
                </div>
            </div>

            <div id="chart"></div>
            <div class="footer">Data source: Supabase BTC/USDT OHLCV</div>
        </div>
    </div>
    <script>
        var series = [{{"name": "Cycle {cycle_num}", "data": {json.dumps(line_data)}}}];
        var boxes = {json.dumps(boxes)};
        var chartInstance = null;
        
        // 박스 사각형 그리기 함수
        function drawBoxRects(chartContext) {{
            if (!chartContext) return;
            
            var chartEl = chartContext.el;
            var gridRect = chartEl.querySelector('.apexcharts-grid');
            if (!gridRect) return;
            
            // 기존 박스 rect 제거
            var oldRects = chartEl.querySelectorAll('.box-rect-group');
            oldRects.forEach(function(el) {{ el.remove(); }});
            
            // 새 그룹 생성
            var rectGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            rectGroup.setAttribute('class', 'box-rect-group');
            
            var w = chartContext.w;
            
            // X축, Y축 config에서 고정값 사용
            var xMin = w.config.xaxis.min !== undefined ? w.config.xaxis.min : 0;
            var xMax = w.config.xaxis.max !== undefined ? w.config.xaxis.max : 420;
            var yMin = w.config.yaxis[0].min !== undefined ? w.config.yaxis[0].min : 0;
            var yMax = w.config.yaxis[0].max !== undefined ? w.config.yaxis[0].max : 100;
            
            // 실제 그리드 영역 계산 (SVG 요소에서 직접)
            var gridBBox = gridRect.getBBox();
            var gridX = gridBBox.x;
            var gridY = gridBBox.y;
            var gridWidth = gridBBox.width;
            var gridHeight = gridBBox.height;
            
            boxes.forEach(function(box) {{
                // X 좌표 계산 (Start_Day ~ End_Day)
                var x1 = gridX + ((box.Start_Day - xMin) / (xMax - xMin)) * gridWidth;
                var x2 = gridX + ((box.End_Day - xMin) / (xMax - xMin)) * gridWidth;
                
                // Y 좌표 계산 (저점 Start_Rate ~ 고점 Peak_Rate, Y축 반전)
                var yTop = gridY + ((yMax - box.Peak_Rate) / (yMax - yMin)) * gridHeight;
                var yBottom = gridY + ((yMax - box.Start_Rate) / (yMax - yMin)) * gridHeight;
                
                var rectWidth = Math.abs(x2 - x1);
                var rectHeight = Math.abs(yBottom - yTop);
                var rectX = Math.min(x1, x2);
                var rectY = Math.min(yTop, yBottom);
                
                // 화면 범위 체크
                if (rectWidth > 0 && rectHeight > 0) {{
                    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    rect.setAttribute('x', rectX);
                    rect.setAttribute('y', rectY);
                    rect.setAttribute('width', rectWidth);
                    rect.setAttribute('height', rectHeight);
                    rect.setAttribute('fill', box.color);
                    rect.setAttribute('fill-opacity', '0.15');
                    rect.setAttribute('stroke', box.color);
                    rect.setAttribute('stroke-width', '1.5');
                    rect.setAttribute('stroke-opacity', '0.8');
                    rectGroup.appendChild(rect);
                }}
            }});
            
            // grid 뒤에 삽입
            if (gridRect && gridRect.parentNode) {{
                gridRect.parentNode.insertBefore(rectGroup, gridRect);
            }}
        }}

        // point annotations (저점/고점 마커)
        var pointAnnotations = [];
        var highColor = '#F87171';
        var lowColor = '#34D399';
        
        boxes.forEach(function(box, idx) {{
            // 전고점 찾기 (이전 박스의 고점, L1이면 100% 기준)
            var prevHigh = idx > 0 ? boxes[idx - 1].Peak_Rate : 100;
            var dropFromPrevHigh = ((box.Start_Rate - prevHigh) / prevHigh * 100).toFixed(0);
            
            // 저점 대비 상승률
            var riseFromLow = ((box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100).toFixed(0);
            
            // 저점 마커
            pointAnnotations.push({{
                x: box.Start_Day,
                y: box.Start_Rate,
                marker: {{ size: 5, fillColor: lowColor, strokeColor: '#fff', strokeWidth: 1 }},
                label: {{ 
                    borderColor: 'transparent', 
                    style: {{ color: '#065F46', background: '#A7F3D0', fontSize: '9px', padding: {{ left: 4, right: 4, top: 1, bottom: 1 }} }}, 
                    text: 'L' + box.Box_ID + ' ' + box.Start_Rate + '% 전고점:' + dropFromPrevHigh + '%', 
                    offsetY: 38,
                    position: 'bottom'
                }}
            }});
            
            // 고점 마커
            pointAnnotations.push({{
                x: box.Peak_Day,
                y: box.Peak_Rate,
                marker: {{ size: 5, fillColor: highColor, strokeColor: '#fff', strokeWidth: 1, shape: 'triangle' }},
                label: {{ 
                    borderColor: 'transparent', 
                    style: {{ color: '#991B1B', background: '#FECACA', fontSize: '9px', padding: {{ left: 4, right: 4, top: 1, bottom: 1 }} }}, 
                    text: 'H' + box.Box_ID + ' ' + box.Peak_Rate + '% 저점:+' + riseFromLow + '%', 
                    offsetY: -8 
                }}
            }});
        }});

        var options = {{
            chart: {{ 
                type: 'line', 
                height: '100%', 
                fontFamily: "'JetBrains Mono', monospace", 
                background: 'transparent', 
                toolbar: {{ show: true }}, 
                zoom: {{ enabled: true, type: 'xy' }},
                events: {{
                    mounted: function(chartContext, config) {{
                        chartInstance = chartContext;
                        setTimeout(function() {{ drawBoxRects(chartContext); }}, 100);
                    }},
                    updated: function(chartContext, config) {{
                        setTimeout(function() {{ drawBoxRects(chartContext); }}, 50);
                    }},
                    zoomed: function(chartContext, config) {{
                        setTimeout(function() {{ drawBoxRects(chartContext); }}, 50);
                    }},
                    beforeResetZoom: function(chartContext, config) {{
                        setTimeout(function() {{ drawBoxRects(chartContext); }}, 100);
                        return config;
                    }},
                    animationEnd: function(chartContext, config) {{
                        drawBoxRects(chartContext);
                    }},
                    selection: function(chartContext, config) {{
                        setTimeout(function() {{ drawBoxRects(chartContext); }}, 50);
                    }}
                }}
            }},
            series: series,
            colors: ['#3B82F6'],
            stroke: {{ curve: 'smooth', width: 2 }},
            grid: {{ borderColor: 'rgba(255,255,255,0.08)', strokeDashArray: 4 }},
            xaxis: {{ type: 'numeric', min: 0, max: 420, tickAmount: 14, title: {{ text: 'Days Since Peak', style: {{ color: '#94A3B8' }} }}, labels: {{ style: {{ colors: '#94A3B8' }} }} }},
            yaxis: {{ min: 0, max: 100, tickAmount: 10, title: {{ text: 'Rate (% of Peak)', style: {{ color: '#94A3B8' }} }}, labels: {{ style: {{ colors: '#94A3B8' }}, formatter: function(v) {{ return v + '%'; }} }} }},
            tooltip: {{ 
                theme: 'dark',
                custom: function({{ series, seriesIndex, dataPointIndex, w }}) {{
                    var data = w.config.series[seriesIndex].data[dataPointIndex];
                    var day = data.x;
                    var rate = data.y;
                    var dateStr = data.timestamp;
                    var boxDay = data.box_day;
                    var boxDuration = data.box_duration;
                    var boxLow = data.box_low;
                    var boxHigh = data.box_high;
                    var prevHigh = data.prev_high;
                    
                    var header = 'Cycle {cycle_num} : ' + dateStr + ' (' + rate.toFixed(2) + '%)';
                    var line2 = '';
                    
                    if (boxDuration !== null && boxLow !== null && boxHigh !== null && boxDay !== null) {{
                        // 박스 내부
                        var distToLow = Math.abs(rate - boxLow);
                        var distToHigh = Math.abs(rate - boxHigh);
                        
                        if (distToLow <= distToHigh) {{
                            var pctFromLow = ((rate - boxLow) / boxLow * 100).toFixed(0);
                            var sign = pctFromLow >= 0 ? '+' : '';
                            line2 = day + 'd 박스(' + boxDay + '/' + boxDuration + 'd) 저점대비:' + sign + pctFromLow + '%';
                        }} else {{
                            var pctFromHigh = ((rate - boxHigh) / boxHigh * 100).toFixed(0);
                            var sign = pctFromHigh >= 0 ? '+' : '';
                            line2 = day + 'd 박스(' + boxDay + '/' + boxDuration + 'd) 고점대비:' + sign + pctFromHigh + '%';
                        }}
                    }} else {{
                        // 박스 외부
                        var pctFromPrevHigh = ((rate - prevHigh) / prevHigh * 100).toFixed(0);
                        var sign = pctFromPrevHigh >= 0 ? '+' : '';
                        line2 = day + 'd 전고점대비:' + sign + pctFromPrevHigh + '%';
                    }}
                    
                    return '<div class="apexcharts-tooltip-title" style="font-family:JetBrains Mono,monospace;font-size:12px;">● ' + header + '</div>' +
                        '<div class="apexcharts-tooltip-series-group apexcharts-active" style="display:flex;padding:6px 10px;">' +
                        '<div class="apexcharts-tooltip-text" style="font-family:JetBrains Mono,monospace;font-size:12px;">' +
                        '<span class="apexcharts-tooltip-text-y-value">' + line2 + '</span>' +
                        '</div></div>';
                }}
            }},
            annotations: {{ points: pointAnnotations }},
            legend: {{ show: false }}
        }};

        var chart = new ApexCharts(document.querySelector("#chart"), options);
        chart.render();
        
        // 홈 버튼 클릭 감지 (toolbar 버튼 클릭 시 박스 다시 그리기)
        setTimeout(function() {{
            var toolbar = document.querySelector('.apexcharts-toolbar');
            if (toolbar) {{
                toolbar.addEventListener('click', function(e) {{
                    // 홈 버튼 또는 다른 툴바 버튼 클릭 시
                    setTimeout(function() {{
                        if (chartInstance) drawBoxRects(chartInstance);
                    }}, 300);
                }});
            }}
            
            // MutationObserver로 차트 변경 감지
            var chartEl = document.querySelector('#chart');
            var observer = new MutationObserver(function(mutations) {{
                if (chartInstance) {{
                    setTimeout(function() {{ drawBoxRects(chartInstance); }}, 50);
                }}
            }});
            observer.observe(chartEl, {{ childList: true, subtree: true }});
        }}, 500);
    </script>
</body>
</html>"""

    if OUTPUT_DIR and not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    output_html = f"{OUTPUT_DIR}/03_boxRanges_cycle_bear{cycle_num}.html"
    with open(output_html, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"   📊 차트 저장: {output_html}")


def main():
    print("=" * 60)
    print("비트코인 사이클 박스권 분석 (Supabase + ApexCharts)")
    print("=" * 60)

    df = load_cycle_data_from_db()
    if df is None:
        return

    # 사이클 번호 추출
    cycle_nums = sorted(
        set(
            int(col.split("_")[0])
            for col in df.columns
            if col.endswith("_rate") and not "low" in col and not "high" in col
        )
    )
    print(f"감지된 사이클: {cycle_nums}")

    all_boxes = []
    for cycle_num in cycle_nums:
        rate_col = f"{cycle_num}_rate"
        if rate_col not in df.columns:
            continue

        print(f"\n📈 Cycle {cycle_num} 분석...")
        cycle_data = df[df[rate_col].notna()].copy()
        if cycle_data.empty:
            continue

        boxes = find_box_ranges(cycle_data, cycle_num, rate_col)
        if boxes:
            all_boxes.extend(boxes)
            visualize_boxes(df, boxes, cycle_num)

    if all_boxes:
        print(f"\n✅ 총 {len(all_boxes)}개 박스권 발견")


if __name__ == "__main__":
    main()
