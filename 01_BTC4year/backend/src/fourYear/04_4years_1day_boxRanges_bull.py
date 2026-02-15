"""
상승장 박스권 분석 (Supabase + ApexCharts 버전)
- 최저점에서 최고점까지의 상승 기간(420~사이클끝) 내에서 조정 구간(박스권) 탐지
- 하락률 5% 이상 구간 식별 및 고점 재돌파 감지
"""

import os
import pandas as pd
import numpy as np
from datetime import datetime
import json
import time
from supabase import create_client, Client
from dotenv import load_dotenv

# --- 환경 변수 로드 ---
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# ==================== 설정 ====================
CYCLE_TABLE_NAME = "bitcoin_cycle_data"
OUTPUT_DIR = "././public/charts"
MIN_DAYS_FROM_PEAK = 420  # 420일부터 상승장 분석
DROP_THRESHOLD = 5.0  # 하락률 5% 이상
BREAK_THRESHOLD = 2.0  # 고점에서 2% 이상 상승 시 박스 종료
MIN_DURATION_DAYS = 1
LOOKBACK_DAYS = 10  # N일 범위에서 최고점일 때만 고점으로 인정


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL과 SUPABASE_KEY 환경변수를 설정하세요")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def load_cycle_data_from_db():
    """Supabase에서 사이클 데이터를 불러와 Wide format으로 변환 (420일부터)"""
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
                .gte("days_since_peak", MIN_DAYS_FROM_PEAK)
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


def is_significant_high(cycle_data, idx, high_rate_col, lookback=LOOKBACK_DAYS):
    """N일 범위에서 최고점인지 확인 (더 의미 있는 고점만 탐지)"""
    if idx < lookback:
        return False

    current = cycle_data.iloc[idx][high_rate_col]

    # 과거 N일 + 미래 N일 범위에서 최고점인지 확인
    start = max(0, idx - lookback)
    end = min(len(cycle_data), idx + lookback + 1)

    range_max = cycle_data.iloc[start:end][high_rate_col].max()
    return current >= range_max


def find_drop_low(cycle_data, start_idx, local_high, low_rate_col):
    """고점에서 5% 이상 하락하는 저점 탐지"""
    j = start_idx + 1
    temp_min = local_high
    temp_min_idx = start_idx

    while j < len(cycle_data):
        current_low = cycle_data.iloc[j][low_rate_col]
        if current_low < temp_min:
            temp_min = current_low
            temp_min_idx = j
        if local_high - temp_min >= DROP_THRESHOLD:
            return True, temp_min, temp_min_idx
        j += 1
    return False, temp_min, temp_min_idx


def find_box_end(
    cycle_data,
    local_high_idx,
    local_high,
    start_search_idx,
    temp_min,
    temp_min_idx,
    low_rate_col,
    high_rate_col,
):
    """박스 종료 지점 찾기: 고점 재돌파(2% 이상) 시 종료"""
    break_threshold = local_high + (local_high * BREAK_THRESHOLD / 100)
    max_search_idx = len(cycle_data)  # 사이클 끝까지

    k = start_search_idx + 1
    box_end_idx = start_search_idx
    box_broken = False
    min_low = temp_min
    min_idx = temp_min_idx

    while k < max_search_idx:
        check_high = cycle_data.iloc[k][high_rate_col]
        current_low = cycle_data.iloc[k][low_rate_col]

        if check_high >= break_threshold:
            box_end_idx = k
            box_broken = True
            break

        if current_low < min_low:
            min_low = current_low
            min_idx = k
        k += 1

    if not box_broken:
        box_end_idx = len(cycle_data) - 1
        box_broken = k >= max_search_idx

    return box_end_idx, box_broken, min_low, min_idx


def create_box_info(
    box_id,
    cycle_num,
    cycle_data,
    local_high_idx,
    local_high,
    min_idx,
    min_low,
    box_end_idx,
    box_broken,
    cols,
):
    drop_pct = local_high - min_low
    return {
        "Cycle": cycle_num,
        "Box_ID": box_id,
        "Start_Day": int(cycle_data.iloc[local_high_idx]["Days_Since_Peak"]),
        "Start_Timestamp": cycle_data.iloc[local_high_idx][cols["timestamp"]],
        "Start_Rate": round(local_high, 2),
        "Low_Day": int(cycle_data.iloc[min_idx]["Days_Since_Peak"]),
        "Low_Timestamp": cycle_data.iloc[min_idx][cols["timestamp"]],
        "Low_Rate": round(min_low, 2),
        "End_Day": int(cycle_data.iloc[box_end_idx]["Days_Since_Peak"]),
        "End_Timestamp": cycle_data.iloc[box_end_idx][cols["timestamp"]],
        "End_Rate": round(cycle_data.iloc[box_end_idx][cols["high_rate"]], 2),
        "Drop_Percent": round(drop_pct, 2),
        "Duration_Days": int(
            cycle_data.iloc[box_end_idx]["Days_Since_Peak"]
            - cycle_data.iloc[local_high_idx]["Days_Since_Peak"]
        ),
        "Box_Broken": box_broken,
    }


def find_box_ranges(cycle_data, cycle_num, rate_col):
    # 420일 이후 데이터만 사용
    cycle_data = cycle_data[cycle_data["Days_Since_Peak"] >= MIN_DAYS_FROM_PEAK].copy()

    if len(cycle_data) < 20:
        return []

    cycle_data = cycle_data.reset_index(drop=True).copy()
    cols = get_column_names(cycle_num)
    low_rate_col, high_rate_col = validate_columns(cycle_data, cols, rate_col)

    boxes = []
    box_id = 0
    i = LOOKBACK_DAYS  # N일 이후부터 탐색 시작

    while i < len(cycle_data):
        if not is_significant_high(cycle_data, i, high_rate_col):
            i += 1
            continue

        local_high = cycle_data.iloc[i][high_rate_col]
        local_high_idx = i

        drop_achieved, temp_min, temp_min_idx = find_drop_low(
            cycle_data, i, local_high, low_rate_col
        )
        if not drop_achieved:
            i += 1
            continue

        box_end_idx, box_broken, min_low, min_idx = find_box_end(
            cycle_data,
            local_high_idx,
            local_high,
            temp_min_idx,
            temp_min,
            temp_min_idx,
            low_rate_col,
            high_rate_col,
        )

        if min_idx > box_end_idx:
            min_low = cycle_data.iloc[local_high_idx : box_end_idx + 1][
                low_rate_col
            ].min()
            min_idx = cycle_data.iloc[local_high_idx : box_end_idx + 1][
                low_rate_col
            ].idxmin()

        box_duration = (
            cycle_data.iloc[box_end_idx]["Days_Since_Peak"]
            - cycle_data.iloc[local_high_idx]["Days_Since_Peak"]
        )
        if box_duration < MIN_DURATION_DAYS:
            i = box_end_idx + 1
            continue

        box_id += 1
        boxes.append(
            create_box_info(
                box_id,
                cycle_num,
                cycle_data,
                local_high_idx,
                local_high,
                min_idx,
                min_low,
                box_end_idx,
                box_broken,
                {**cols, "high_rate": high_rate_col},
            )
        )
        i = box_end_idx + 1

    print(f"   ✅ {len(boxes)}개 조정 박스권 발견")
    return boxes


def visualize_boxes(df, boxes, cycle_num):
    """박스권을 ApexCharts로 시각화 (깔끔한 버전)"""
    cols = get_column_names(cycle_num)
    cycle_data = df[df[cols["rate"]].notna()].copy()
    # 420일부터 사이클 끝까지
    cycle_data = cycle_data[cycle_data["Days_Since_Peak"] >= MIN_DAYS_FROM_PEAK]
    if cycle_data.empty:
        return

    high_rate_col = (
        cols["high_rate"] if cols["high_rate"] in cycle_data.columns else cols["rate"]
    )

    # 라인 데이터 (고점 기준)
    line_data = [
        {"x": int(row["Days_Since_Peak"]), "y": round(row[high_rate_col], 2)}
        for _, row in cycle_data.iterrows()
    ]

    # Y축 최대값 동적 설정 (데이터의 최대값 + 10% 여유)
    y_max = cycle_data[high_rate_col].max()
    y_max = max(y_max * 1.1, 100)  # 최소 100으로, 최대값의 110%
    y_max = int(y_max / 10 + 1) * 10  # 10 단위로 올림

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

    # 시작/끝 날짜
    first_timestamp = cycle_data.iloc[0][cols["timestamp"]]
    last_timestamp = cycle_data.iloc[-1][cols["timestamp"]]
    try:
        start_date = pd.to_datetime(first_timestamp).strftime("%Y.%m")
        end_date = pd.to_datetime(last_timestamp).strftime("%Y.%m")
    except:
        start_date = str(first_timestamp)[:7]
        end_date = str(last_timestamp)[:7]

    max_days = int(cycle_data["Days_Since_Peak"].max())

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cycle {cycle_num} Bull - Box Range Analysis</title>
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
                    <h2>Cycle {cycle_num} Bull ({start_date}~{end_date}) - Correction Box Range Analysis</h2>
                    <p>Drop ≥{DROP_THRESHOLD}%, Breakup &lt;{BREAK_THRESHOLD}%</p>
                </div>
            </div>
            <div id="chart"></div>
            <div class="footer">Data source: Supabase BTC/USDT OHLCV (Day {MIN_DAYS_FROM_PEAK}~{max_days})</div>
        </div>
    </div>
    <script>
        var series = [{{"name": "Cycle {cycle_num}", "data": {json.dumps(line_data)}}}];
        var boxes = {json.dumps(boxes)};
        var chartInstance = null;

        // 마우스 위치에 따른 박스 정보 표시
        function getBoxAtPosition(dayX) {{
            for (let box of boxes) {{
                if (dayX >= box.Start_Day && dayX <= box.End_Day) {{
                    return box;
                }}
            }}
            return null;
        }}
        
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
            var xMin = w.config.xaxis.min !== undefined ? w.config.xaxis.min : w.globals.minX;
            var xMax = w.config.xaxis.max !== undefined ? w.config.xaxis.max : w.globals.maxX;
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
                
                // Y 좌표 계산 (bull: Start_Rate가 고점, Low_Rate가 저점)
                var yTop = gridY + ((yMax - box.Start_Rate) / (yMax - yMin)) * gridHeight;
                var yBottom = gridY + ((yMax - box.Low_Rate) / (yMax - yMin)) * gridHeight;
                
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

        // point annotations (고점/저점 마커)
        var pointAnnotations = [];
        var highColor = '#EF4444';  // 고점: 빨강
        var lowColor = '#10B981';   // 저점: 초록
        
        boxes.forEach(function(box, idx) {{
            // 전저점 찾기 (이전 박스의 저점, 없으면 현재 고점 기준)
            var prevLow = idx > 0 ? boxes[idx - 1].Low_Rate : box.Start_Rate;
            var riseFromPrevLow = ((box.Start_Rate - prevLow) / prevLow * 100).toFixed(0);
            
            // 고점 대비 하락률
            var dropFromHigh = (-(box.Start_Rate - box.Low_Rate) / box.Start_Rate * 100).toFixed(0);
            
            // 고점 마커 (삼각형, 원 위에 라벨)
            pointAnnotations.push({{
                x: box.Start_Day,
                y: box.Start_Rate,
                marker: {{ size: 5, fillColor: highColor, strokeColor: '#fff', strokeWidth: 1, shape: 'triangle' }},
                label: {{ 
                    borderColor: highColor, 
                    style: {{ color: '#fff', background: highColor, fontSize: '9px', padding: {{ left: 4, right: 4, top: 1, bottom: 1 }} }}, 
                    text: 'H' + box.Box_ID + ' ' + box.Start_Rate + '% 전저점:+' + riseFromPrevLow + '%', 
                    offsetY: -8 
                }}
            }});
            
            // 저점 마커 (원, 원 아래에 라벨)
            pointAnnotations.push({{
                x: box.Low_Day,
                y: box.Low_Rate,
                marker: {{ size: 5, fillColor: lowColor, strokeColor: '#fff', strokeWidth: 1 }},
                label: {{ 
                    borderColor: lowColor, 
                    style: {{ color: '#fff', background: lowColor, fontSize: '9px', padding: {{ left: 4, right: 4, top: 1, bottom: 1 }} }}, 
                    text: 'L' + box.Box_ID + ' ' + box.Low_Rate + '% 고점:' + dropFromHigh + '%', 
                    offsetY: 38,
                    position: 'bottom'
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
            xaxis: {{ type: 'numeric', min: {MIN_DAYS_FROM_PEAK}, max: {max_days}, tickAmount: 10, title: {{ text: 'Days Since Peak', style: {{ color: '#94A3B8' }} }}, labels: {{ style: {{ colors: '#94A3B8' }} }} }},
            yaxis: {{ min: 0, max: {y_max}, tickAmount: 10, title: {{ text: 'Rate (% of Peak)', style: {{ color: '#94A3B8' }} }}, labels: {{ style: {{ colors: '#94A3B8' }}, formatter: function(v) {{ return v + '%'; }} }} }},
            tooltip: {{ 
                theme: 'dark',
                custom: function({{series, seriesIndex, dataPointIndex, w}}) {{
                    var data = w.globals.initialSeries[seriesIndex].data;
                    var point = data[dataPointIndex];
                    var dayX = point.x;
                    var val = point.y.toFixed(2);
                    var box = getBoxAtPosition(dayX);
                    
                    if (box) {{
                        return '<div style="padding:12px; background:' + box.color + '; border-radius:6px; color:#000; font-weight:bold; border:2px solid #fff;">' +
                            'Box ' + box.Box_ID + '<br/>' +
                            '<span style="font-size:14px;">-' + box.Drop_Percent.toFixed(1) + '%</span><br/>' +
                            '<span style="font-size:11px;">Day ' + box.Start_Day + '-' + box.End_Day + ' (' + box.Duration_Days + 'd)</span><br/>' +
                            '<span style="font-size:10px;opacity:0.9;">High: ' + box.Start_Rate + '% → Low: ' + box.Low_Rate + '%</span>' +
                            '</div>';
                    }}
                    
                    return '<div style="padding:8px; background:rgba(59,130,246,0.9); border-radius:6px; color:#fff;">' +
                        '<span>Day ' + dayX + '</span><br/>' +
                        '<span style="font-size:12px;">Rate: ' + val + '%</span>' +
                        '</div>';
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

    output_html = f"{OUTPUT_DIR}/04_boxRanges_bull_cycle{cycle_num}.html"
    with open(output_html, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"   📊 차트 저장: {output_html}")


def main():
    print("=" * 60)
    print("비트코인 사이클 상승장 조정 박스권 분석 (Supabase + ApexCharts)")
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
