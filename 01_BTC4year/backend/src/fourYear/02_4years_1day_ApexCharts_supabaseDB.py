import os
import pandas as pd
import numpy as np
import json
from supabase import create_client, Client
from dotenv import load_dotenv

# --- 환경 변수 로드 ---
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# --- 설정 변수 ---
CYCLE_TABLE_NAME = "bitcoin_cycle_data"
OUTPUT_PLOT_FILE = "././public/charts/02_4years_1day_ApexCharts_supabase.html"


def get_supabase_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL과 SUPABASE_KEY 환경변수를 설정하세요")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def load_cycle_data_from_db():
    """Supabase에서 사이클 데이터를 불러와 Wide format으로 변환합니다."""
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
            if col_type == "timestamp":
                new_columns.append(f"{cycle_num}_timestamp")
            elif col_type == "close_price":
                new_columns.append(f"{cycle_num}_close")
            elif col_type == "low_price":
                new_columns.append(f"{cycle_num}_low")
            elif col_type == "high_price":
                new_columns.append(f"{cycle_num}_high")
            elif col_type == "close_rate":
                new_columns.append(f"{cycle_num}_rate")
            elif col_type == "low_rate":
                new_columns.append(f"{cycle_num}_low_rate")
            elif col_type == "high_rate":
                new_columns.append(f"{cycle_num}_high_rate")

        result_df.columns = new_columns
        result_df.reset_index(inplace=True)
        result_df.rename(columns={"days_since_peak": "Days_Since_Peak"}, inplace=True)

        print(f"Supabase에서 {len(result_df)}개 행의 사이클 데이터를 로드했습니다.")
        return result_df

    except Exception as e:
        print(f"데이터베이스에서 데이터 로드 중 오류: {e}")
        import traceback

        traceback.print_exc()
        return None


def create_cycle_plot(result_df):
    """ApexCharts를 사용한 사이클 비교 그래프 HTML을 생성합니다."""
    if result_df is None or result_df.empty:
        print("그래프 생성을 위한 데이터가 없습니다.")
        return False

    result_df_plot = result_df.copy()

    colors = [
        "#3B82F6",
        "#10B981",
        "#EF4444",
        "#F59E0B",
        "#8B5CF6",
        "#EC4899",
        "#06B6D4",
        "#84CC16",
    ]

    series_data = []
    annotations_y = []
    cycle_num = 1

    while f"{cycle_num}_rate" in result_df_plot.columns:
        valid_data = result_df_plot.dropna(subset=[f"{cycle_num}_rate"])

        if not valid_data.empty:
            color = colors[(cycle_num - 1) % len(colors)]

            start_date_str = ""
            end_date_str = ""
            if f"{cycle_num}_timestamp" in result_df_plot.columns:
                peak_row = result_df_plot[result_df_plot["Days_Since_Peak"] == 0]
                if not peak_row.empty and pd.notna(
                    peak_row[f"{cycle_num}_timestamp"].values[0]
                ):
                    peak_timestamp = peak_row[f"{cycle_num}_timestamp"].values[0]
                    try:
                        start_date_str = pd.to_datetime(peak_timestamp).strftime(
                            "%Y.%m.%d"
                        )
                    except:
                        start_date_str = str(peak_timestamp)[:10].replace("/", ".")

                last_timestamp = valid_data[f"{cycle_num}_timestamp"].iloc[-1]
                if pd.notna(last_timestamp):
                    try:
                        end_date_str = pd.to_datetime(last_timestamp).strftime(
                            "%Y.%m.%d"
                        )
                    except:
                        end_date_str = str(last_timestamp)[:10].replace("/", ".")

            data_points = []
            for _, row in valid_data.iterrows():
                data_points.append(
                    {
                        "x": int(row["Days_Since_Peak"]),
                        "y": round(row[f"{cycle_num}_rate"], 2),
                    }
                )

            series_name = f"Cycle {cycle_num} : {start_date_str}"
            day_count = len(data_points)

            series_data.append(
                {
                    "name": series_name,
                    "data": data_points,
                    "startDate": start_date_str,
                    "endDate": end_date_str,
                    "dayCount": day_count,
                }
            )

            min_rate = valid_data[f"{cycle_num}_rate"].min()
            if not pd.isna(min_rate):
                annotations_y.append(
                    {
                        "y": round(min_rate, 2),
                        "borderColor": color,
                        "borderWidth": 1.5,
                        "strokeDashArray": 4,
                        "label": {
                            "borderColor": "transparent",
                            "style": {
                                "color": color,
                                "background": "transparent",
                                "fontSize": "10px",
                                "fontWeight": "500",
                            },
                            "text": f"Cycle {cycle_num} Min ({min_rate:.2f}%)",
                            "position": "right",
                            "offsetX": -5,
                        },
                    }
                )

        cycle_num += 1

    annotations_y.insert(
        0,
        {
            "y": 100,
            "borderColor": "#64748B",
            "borderWidth": 2,
            "strokeDashArray": 6,
            "label": {
                "borderColor": "transparent",
                "style": {
                    "color": "#94A3B8",
                    "background": "transparent",
                    "fontSize": "11px",
                    "fontWeight": "500",
                },
                "text": "Peak (100%)",
                "position": "right",
            },
        },
    )

    for y_val in [50, 25]:
        annotations_y.append(
            {
                "y": y_val,
                "borderColor": "rgba(148, 163, 184, 0.3)",
                "borderWidth": 1,
                "strokeDashArray": 3,
            }
        )

    y_max = 100
    x_max = int(result_df_plot["Days_Since_Peak"].max())

    chart_options = {
        "chart": {
            "type": "line",
            "height": "100%",
            "fontFamily": "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
            "background": "transparent",
            "animations": {
                "enabled": True,
                "easing": "easeinout",
                "speed": 800,
                "animateGradually": {"enabled": True, "delay": 150},
            },
            "toolbar": {"show": False},
            "zoom": {"enabled": True, "type": "xy", "autoScaleYaxis": True},
            "dropShadow": {
                "enabled": True,
                "color": "#000",
                "top": 3,
                "left": 0,
                "blur": 4,
                "opacity": 0.1,
            },
        },
        "colors": colors[: len(series_data)],
        "dataLabels": {"enabled": False},
        "stroke": {"curve": "smooth", "width": 2.5, "lineCap": "round"},
        "grid": {
            "show": True,
            "borderColor": "rgba(255, 255, 255, 0.08)",
            "strokeDashArray": 4,
            "position": "back",
            "xaxis": {"lines": {"show": True}},
            "yaxis": {"lines": {"show": True}},
        },
        "markers": {"size": 0, "hover": {"size": 6, "sizeOffset": 3}},
        "xaxis": {
            "type": "numeric",
            "min": 0,
            "max": x_max,
            "tickAmount": 14,
            "title": {
                "text": "Days Since Peak",
                "style": {"fontSize": "13px", "fontWeight": 600, "color": "#94A3B8"},
            },
            "labels": {"style": {"colors": "#94A3B8", "fontSize": "11px"}},
            "axisBorder": {"show": True, "color": "rgba(255, 255, 255, 0.1)"},
            "axisTicks": {"show": True, "color": "rgba(255, 255, 255, 0.1)"},
            "crosshairs": {
                "show": True,
                "stroke": {"color": "#F59E0B", "width": 1, "dashArray": 3},
            },
        },
        "yaxis": {
            "min": 0,
            "max": y_max,
            "tickAmount": 10,
            "title": {
                "text": "Price Rate (%) vs. Cycle Peak",
                "style": {"fontSize": "13px", "fontWeight": 600, "color": "#94A3B8"},
            },
            "labels": {
                "style": {"colors": "#94A3B8", "fontSize": "11px"},
                "formatter": "FORMATTER_PLACEHOLDER",
            },
        },
        "tooltip": {
            "enabled": True,
            "shared": True,
            "intersect": False,
            "theme": "dark",
            "style": {"fontSize": "12px"},
            "x": {"show": True, "formatter": "X_FORMATTER_PLACEHOLDER"},
            "y": {"formatter": "Y_FORMATTER_PLACEHOLDER"},
        },
        "legend": {"show": False},
        "annotations": {"yaxis": annotations_y},
        "responsive": [
            {
                "breakpoint": 768,
                "options": {"chart": {"height": 400}, "xaxis": {"tickAmount": 7}},
            }
        ],
    }

    html_content = generate_html(series_data, chart_options)

    with open(OUTPUT_PLOT_FILE, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"인터랙티브 그래프가 성공적으로 '{OUTPUT_PLOT_FILE}'에 저장되었습니다.")
    return True


def generate_html(series_data, chart_options):
    options_json = json.dumps(chart_options, indent=2)
    options_json = options_json.replace(
        '"FORMATTER_PLACEHOLDER"', 'function(val) { return val.toFixed(0) + "%"; }'
    )
    options_json = options_json.replace(
        '"X_FORMATTER_PLACEHOLDER"', 'function(val) { return "Day " + val; }'
    )
    options_json = options_json.replace(
        '"Y_FORMATTER_PLACEHOLDER"', 'function(val) { return val.toFixed(2) + "%"; }'
    )
    series_json = json.dumps(series_data)

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bitcoin Cycles Comparison</title>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        
        html {{ height: 100%; }}
        body {{ height: 100%; overflow-x: hidden; overflow-y: auto; }}
        
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(180deg, #020617 0%, #0F172A 100%);
            min-height: 100vh;
            padding: 20px;
            display: flex;
            flex-direction: column;
        }}
        
        .container {{ flex: 1; display: flex; flex-direction: column; max-width: 1400px; width: 100%; margin: 0 auto; min-height: 0; }}
        
        .chart-wrapper {{
            flex: 1;
            display: flex;
            flex-direction: column;
            background: linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%);
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.05);
            min-height: 0;
        }}
        
        /* 헤더 */
        .header {{
            flex-shrink: 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            flex-wrap: wrap;
            gap: 12px;
        }}
        
        .header-title h2 {{
            font-size: 18px;
            font-weight: 700;
            color: #F8FAFC;
            letter-spacing: -0.02em;
            white-space: nowrap;
        }}
        
        /* 툴바 */
        .toolbar {{
            display: flex;
            align-items: center;
            gap: 4px;
        }}
        
        .toolbar-btn {{
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #94A3B8;
            cursor: pointer;
            transition: all 0.2s;
        }}
        
        .toolbar-btn:hover {{ background: rgba(255, 255, 255, 0.1); color: #E2E8F0; }}
        .toolbar-btn.active {{ background: rgba(59, 130, 246, 0.2); border-color: rgba(59, 130, 246, 0.5); color: #3B82F6; }}
        .toolbar-btn svg {{ width: 16px; height: 16px; }}
        .toolbar-divider {{ width: 1px; height: 20px; background: rgba(255, 255, 255, 0.1); margin: 0 4px; }}
        
        /* 스탯 카드 (한 줄 컴팩트 스타일) */
        .stats {{
            display: flex;
            gap: 6px;
            flex-wrap: nowrap;
            flex: 1;
            justify-content: center;
            align-items: center;
        }}
        
        .stat-card {{
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 4px;
            padding: 4px 10px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        
        .stat-card:hover {{ background: rgba(255, 255, 255, 0.06); }}
        .stat-card.inactive {{ opacity: 0.3; }}
        
        .stat-card.blue {{ border-left: 2px solid #3B82F6; }}
        .stat-card.green {{ border-left: 2px solid #10B981; }}
        .stat-card.red {{ border-left: 2px solid #EF4444; }}
        .stat-card.orange {{ border-left: 2px solid #F59E0B; }}
        
        .stat-label {{
            font-size: 9px;
            font-weight: 600;
            letter-spacing: 0.02em;
            white-space: nowrap;
        }}
        
        .stat-label.blue {{ color: #3B82F6; }}
        .stat-label.green {{ color: #10B981; }}
        .stat-label.red {{ color: #EF4444; }}
        .stat-label.orange {{ color: #F59E0B; }}
        
        .stat-value {{
            font-size: 9px;
            font-weight: 500;
            color: #94A3B8;
            font-family: 'JetBrains Mono', monospace;
            display: flex;
            gap: 8px;
            white-space: nowrap;
        }}
        
        .stat-min {{ color: #F8FAFC; }}
        .stat-days {{ color: #64748B; }}
        
        /* 축 범위 컨트롤 */
        .axis-controls {{
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 12px;
            padding: 10px 16px;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            flex-wrap: wrap;
            transition: all 0.3s ease;
            overflow: hidden;
            max-height: 60px;
            opacity: 1;
        }}
        
        .axis-controls.hidden {{
            max-height: 0;
            padding: 0 16px;
            margin-bottom: 0;
            opacity: 0;
            border-color: transparent;
        }}
        
        .axis-group {{ display: flex; align-items: center; gap: 8px; }}
        .axis-group-label {{ font-size: 11px; font-weight: 600; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; }}
        .axis-inputs {{ display: flex; align-items: center; gap: 4px; }}
        
        .axis-input {{
            width: 70px;
            padding: 6px 8px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            color: #E2E8F0;
            font-size: 12px;
            font-family: 'JetBrains Mono', monospace;
            text-align: center;
        }}
        
        .axis-input:focus {{ outline: none; border-color: #3B82F6; background: rgba(59, 130, 246, 0.1); }}
        .axis-separator {{ color: #64748B; font-size: 12px; }}
        
        .apply-btn {{
            padding: 8px 16px;
            background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
            border: none;
            border-radius: 6px;
            color: white;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }}
        
        .apply-btn:hover {{ transform: translateY(-1px); box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4); }}
        
        .reset-btn {{
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: #94A3B8;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }}
        
        .reset-btn:hover {{ background: rgba(255, 255, 255, 0.1); color: #E2E8F0; }}
        
        #chart {{ flex: 1; margin: 0 -12px; min-height: 0; }}
        
        .footer {{
            flex-shrink: 0;
            display: flex;
            justify-content: center;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }}
        
        .footer-left {{ font-size: 11px; color: #64748B; }}
        
        /* 모바일 대응 */
        @media (max-width: 768px) {{
            body {{ padding: 12px; }}
            .chart-wrapper {{ padding: 12px; border-radius: 12px; min-height: 500px; }}
            .header {{ flex-direction: column; align-items: flex-start; gap: 8px; }}
            .header-title h2 {{ font-size: 14px; }}
            .stats {{ flex-wrap: wrap; gap: 4px; }}
            .stat-card {{ padding: 3px 6px; }}
            .stat-label {{ font-size: 8px; }}
            .stat-value {{ font-size: 8px; gap: 4px; }}
            .toolbar {{ gap: 2px; }}
            .toolbar-btn {{ width: 28px; height: 28px; }}
            .toolbar-btn svg {{ width: 14px; height: 14px; }}
            .axis-controls {{ padding: 8px 12px; gap: 8px; }}
            .axis-input {{ width: 55px; padding: 4px 6px; font-size: 11px; }}
            .apply-btn, .reset-btn {{ padding: 6px 12px; font-size: 11px; }}
            #chart {{ margin: 0 -6px; min-height: 350px; }}
            .footer {{ margin-top: 8px; padding-top: 8px; }}
            .footer-left {{ font-size: 9px; }}
        }}
        
        /* 터치 디바이스 */
        @media (pointer: coarse) {{
            .toolbar-btn {{ width: 36px; height: 36px; }}
            .stat-card {{ padding: 6px 10px; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="chart-wrapper">
            <!-- 헤더: 타이틀 + 스탯카드 + 툴바 -->
            <div class="header">
                <div class="header-title">
                    <h2>Bitcoin Cycles Comparison</h2>
                </div>
                <div class="stats" id="stats-container"></div>
                <div class="toolbar">
                    <button class="toolbar-btn" id="btn-zoomin" title="확대">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="M21 21l-4.35-4.35M11 8v6M8 11h6"></path>
                        </svg>
                    </button>
                    <button class="toolbar-btn" id="btn-zoomout" title="축소">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="M21 21l-4.35-4.35M8 11h6"></path>
                        </svg>
                    </button>
                    <div class="toolbar-divider"></div>
                    <button class="toolbar-btn" id="btn-pan" title="이동">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path>
                            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"></path>
                        </svg>
                    </button>
                    <button class="toolbar-btn active" id="btn-zoom" title="영역 선택">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <rect x="8" y="8" width="8" height="8" rx="1" ry="1" fill="currentColor" opacity="0.3"></rect>
                        </svg>
                    </button>
                    <div class="toolbar-divider"></div>
                    <button class="toolbar-btn" id="btn-settings" title="축 설정">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"></path>
                        </svg>
                    </button>
                    <button class="toolbar-btn" id="btn-reset" title="초기화">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                            <path d="M3 3v5h5"></path>
                        </svg>
                    </button>
                </div>
            </div>
            
            <!-- 축 범위 컨트롤 (기본 숨김) -->
            <div class="axis-controls hidden" id="axis-controls">
                <div class="axis-group">
                    <span class="axis-group-label">X축 (Day)</span>
                    <div class="axis-inputs">
                        <input type="number" id="xMin" class="axis-input" placeholder="Min" value="0">
                        <span class="axis-separator">~</span>
                        <input type="number" id="xMax" class="axis-input" placeholder="Max">
                    </div>
                </div>
                <div class="axis-group">
                    <span class="axis-group-label">Y축 (%)</span>
                    <div class="axis-inputs">
                        <input type="number" id="yMin" class="axis-input" placeholder="Min" value="0">
                        <span class="axis-separator">~</span>
                        <input type="number" id="yMax" class="axis-input" placeholder="Max" value="100">
                    </div>
                </div>
                <button class="apply-btn" onclick="applyAxisRange()">적용</button>
                <button class="reset-btn" onclick="resetAxisRange()">초기화</button>
            </div>
            
            <!-- 차트 -->
            <div id="chart"></div>
            
            <!-- 푸터 -->
            <div class="footer">
                <div class="footer-left">Data source: Supabase BTC/USDT OHLCV</div>
            </div>
        </div>
    </div>

    <script>
        var series = {series_json};
        var options = {options_json};
        var colors = ['#3B82F6', '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];
        var colorNames = ['blue', 'green', 'red', 'orange', 'purple', 'pink', 'cyan', 'lime'];
        
        // 스탯 카드 생성 (클릭하면 시리즈 토글) - 한 줄 컴팩트
        var statsContainer = document.getElementById('stats-container');
        series.forEach(function(s, idx) {{
            var minVal = Math.min.apply(null, s.data.map(function(d) {{ return d.y; }}));
            var colorClass = colorNames[idx % colorNames.length];
            var labelText = 'C' + (idx + 1) + ':' + s.startDate;
            
            var card = document.createElement('div');
            card.className = 'stat-card ' + colorClass;
            card.dataset.index = idx;
            card.innerHTML = '<span class="stat-label ' + colorClass + '">' + labelText + '</span>' +
                           '<span class="stat-value">' +
                           '<span class="stat-min">' + minVal.toFixed(1) + '%</span>' +
                           '<span class="stat-days">' + s.dayCount + 'd</span>' +
                           '</span>';
            card.onclick = function() {{
                this.classList.toggle('inactive');
                chart.toggleSeries(series[idx].name);
            }};
            statsContainer.appendChild(card);
        }});
        
        var initialXMin = options.xaxis.min;
        var initialXMax = options.xaxis.max;
        var initialYMin = options.yaxis.min;
        var initialYMax = options.yaxis.max;
        
        document.getElementById('xMin').value = initialXMin;
        document.getElementById('xMax').value = initialXMax;
        document.getElementById('yMin').value = initialYMin;
        document.getElementById('yMax').value = initialYMax;
        
        var chart = new ApexCharts(document.querySelector("#chart"), {{ ...options, series: series }});
        chart.render();
        
        // 툴바 이벤트
        document.getElementById('btn-zoomin').onclick = function() {{
            var currentXMin = options.xaxis.min;
            var currentXMax = options.xaxis.max;
            var range = currentXMax - currentXMin;
            chart.zoomX(currentXMin + range * 0.2, currentXMax - range * 0.2);
        }};
        
        document.getElementById('btn-zoomout').onclick = function() {{
            chart.zoomX(initialXMin, initialXMax);
        }};
        
        document.getElementById('btn-pan').onclick = function() {{
            setToolbarActive('btn-pan');
        }};
        
        document.getElementById('btn-zoom').onclick = function() {{
            setToolbarActive('btn-zoom');
        }};
        
        // 설정 버튼 (축 컨트롤 토글)
        document.getElementById('btn-settings').onclick = function() {{
            var axisControls = document.getElementById('axis-controls');
            var btn = document.getElementById('btn-settings');
            axisControls.classList.toggle('hidden');
            btn.classList.toggle('active');
        }};
        
        document.getElementById('btn-reset').onclick = function() {{
            chart.zoomX(initialXMin, initialXMax);
            chart.updateOptions({{ yaxis: {{ min: initialYMin, max: initialYMax }} }});
            document.getElementById('xMin').value = initialXMin;
            document.getElementById('xMax').value = initialXMax;
            document.getElementById('yMin').value = initialYMin;
            document.getElementById('yMax').value = initialYMax;
        }};
        
        function setToolbarActive(activeId) {{
            document.querySelectorAll('.toolbar-btn').forEach(function(btn) {{
                if (btn.id === 'btn-zoomin' || btn.id === 'btn-zoomout' || btn.id === 'btn-reset') return;
                btn.classList.remove('active');
            }});
            document.getElementById(activeId).classList.add('active');
        }}
        
        function applyAxisRange() {{
            var xMin = parseFloat(document.getElementById('xMin').value) || 0;
            var xMax = parseFloat(document.getElementById('xMax').value) || initialXMax;
            var yMin = parseFloat(document.getElementById('yMin').value) || 0;
            var yMax = parseFloat(document.getElementById('yMax').value) || 100;
            chart.updateOptions({{ xaxis: {{ min: xMin, max: xMax }}, yaxis: {{ min: yMin, max: yMax }} }});
        }}
        
        function resetAxisRange() {{
            document.getElementById('xMin').value = initialXMin;
            document.getElementById('xMax').value = initialXMax;
            document.getElementById('yMin').value = initialYMin;
            document.getElementById('yMax').value = initialYMax;
            chart.updateOptions({{ xaxis: {{ min: initialXMin, max: initialXMax }}, yaxis: {{ min: initialYMin, max: initialYMax }} }});
        }}
        
        document.querySelectorAll('.axis-input').forEach(function(input) {{
            input.addEventListener('keypress', function(e) {{ if (e.key === 'Enter') applyAxisRange(); }});
        }});
    </script>
</body>
</html>"""

    return html


def main():
    print("=== Bitcoin Cycle 그래프 생성 (Supabase + ApexCharts) ===")
    result_df = load_cycle_data_from_db()

    if result_df is not None:
        success = create_cycle_plot(result_df)
        if success:
            print("\n그래프 생성이 완료되었습니다.")
            total_days = result_df["Days_Since_Peak"].max()
            rate_cols = [
                col
                for col in result_df.columns
                if col.endswith("_rate") and "low" not in col and "high" not in col
            ]
            print(f"- 총 분석 기간: {total_days}일")
            print(f"- 사이클 개수: {len(rate_cols)}개")
        else:
            print("그래프 생성 중 오류가 발생했습니다.")
    else:
        print("데이터를 불러올 수 없어 그래프를 생성하지 못했습니다.")


if __name__ == "__main__":
    main()
