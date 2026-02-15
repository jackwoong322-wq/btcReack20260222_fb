"""
=============================================================================
Binance OHLCV 데이터 동기화 프로그램 (UTC 기준)
=============================================================================
주요 기능:
1. binance_ohlcv_2025.db의 모든 테이블(7개 시간봉)을 자동 확인
2. 누락된 데이터를 Binance REST API에서 실시간 가져와서 SQLite DB에 저장
3. 각 시간봉별로 연속된 데이터가 있는지 무결성 검사 후 자동 보완
4. 사용자 지정 기간의 데이터 완전성 보장
5. 선택적 실시간 최신 데이터 자동 업데이트 (while문 지원)

⏰ 모든 시간은 UTC 기준입니다

지원 시간봉: 1분, 5분, 15분, 30분, 1시간, 4시간, 일봉
API 제한: Binance 1200 requests/minute 준수 (0.1초 간격)

분석 기능:
- 데이터 패턴 분석은 data_analyzer.py 모듈을 사용하세요
- 백테스팅은 별도 백테스팅 스크립트를 사용하세요
=============================================================================
"""

# 필수 라이브러리 임포트
import sqlite3  # SQLite 데이터베이스 연결 및 조작
import requests  # Binance REST API 호출
import time  # API 호출 간격 제어 및 sleep
import pandas as pd  # 데이터 처리 (현재 사용 안함, 향후 확장용)
from datetime import datetime, timedelta, timezone  # 날짜/시간 처리
import json  # JSON 데이터 파싱 (현재 사용 안함)

# =============================================================================
# 전역 설정 변수
# =============================================================================

# 데이터베이스 및 API 설정
SYMBOL_LIST = ("BTCUSDT",)  # 거래 심볼 (BTC/USDT 페어)
BINANCE_API_URL = (
    "https://api.binance.com/api/v3/klines"  # Binance 캔들스틱 API 엔드포인트
)

# 사용자 요청 기간 설정 (UTC 기준)
START_DATE = "2017-11-01"  # UTC 기준 시작 날짜
END_DATE = "2026-12-16"  # UTC 기준 종료 날짜

# 최신 데이터 자동 업데이트 제어
UPDATE_TO_CURRENT = (
    True  # True: 현재 시간까지 자동 업데이트, False: 사용자 요청 기간만 처리
)
MAX_UPDATE_DAYS = (
    7  # 최신 업데이트 시 최대 일수 제한 (과도한 API 호출 및 시간 소요 방지)
)

# 실시간 지속적 업데이트 설정 (UPDATE_TO_CURRENT = True일 때만 동작)
CONTINUOUS_UPDATE = (
    True  # True: while문으로 무한 반복 업데이트, False: 1회만 실행 후 종료
)
UPDATE_INTERVAL = 10  # 반복 업데이트 간격 (초 단위, 10초마다 최신 데이터 체크)

# 지원하는 시간봉별 설정 (총 7개 시간봉)
# 각 설정은 Binance API 호출 및 DB 테이블 관리에 사용됨
TIMEFRAME_CONFIG = {
    # 'ohlcv_1m': {                           # 1분봉 테이블
    #     'interval': '1m',                   # Binance API 요청 시 사용할 간격 파라미터
    #     'milliseconds': 60 * 1000,          # 1분 = 60초 * 1000ms (타임스탬프 계산용)
    #     'description': '1분봉'              # 사용자 출력용 설명
    # },
    # 'ohlcv_5m': {                           # 5분봉 테이블
    #     'interval': '5m',                   # Binance API 5분 간격
    #     'milliseconds': 5 * 60 * 1000,      # 5분 = 300초 * 1000ms
    #     'description': '5분봉'
    # },
    # 'ohlcv_15m': {                          # 15분봉 테이블
    #     'interval': '15m',                  # Binance API 15분 간격
    #     'milliseconds': 15 * 60 * 1000,     # 15분 = 900초 * 1000ms
    #     'description': '15분봉'
    # },
    # 'ohlcv_30m': {                          # 30분봉 테이블
    #     'interval': '30m',                  # Binance API 30분 간격
    #     'milliseconds': 30 * 60 * 1000,     # 30분 = 1800초 * 1000ms
    #     'description': '30분봉'
    # },
    # 'ohlcv_1hour': {                        # 1시간봉 테이블
    #     'interval': '1h',                   # Binance API 1시간 간격
    #     'milliseconds': 60 * 60 * 1000,     # 1시간 = 3600초 * 1000ms
    #     'description': '1시간봉'
    # },
    # 'ohlcv_4hour': {                        # 4시간봉 테이블
    #     'interval': '4h',                   # Binance API 4시간 간격
    #     'milliseconds': 4 * 60 * 60 * 1000, # 4시간 = 14400초 * 1000ms
    #     'description': '4시간봉'
    # },
    "ohlcv_1day": {  # 일봉 테이블
        "interval": "1d",  # Binance API 1일 간격
        "milliseconds": 24 * 60 * 60 * 1000,  # 1일 = 86400초 * 1000ms
        "description": "일봉",
    }
}

# Binance API 호출 제한 및 안전 설정
# Binance 공식 제한: 1200 requests/minute (분당 1200회)
# 안전 마진을 위해 초당 10회로 제한 (분당 600회, 50% 여유)
API_DELAY = 0.1  # 각 API 호출 간 대기 시간 (초 단위)
MAX_KLINES_PER_REQUEST = 1000  # Binance API 한 번에 가져올 수 있는 최대 캔들 개수

# =============================================================================
# 기본 유틸리티 함수들
# =============================================================================


def db_exists():
    """
    SQLite 데이터베이스 파일 존재 여부 확인

    Returns:
        bool: DB 파일이 존재하면 True, 없으면 False
    """
    import os

    return os.path.exists(DB_PATH)


def convert_date_to_timestamp(date_str):
    """
    UTC 날짜 문자열을 Binance API에서 사용하는 밀리초 타임스탬프로 변환

    Args:
        date_str (str): 'YYYY-MM-DD' 형식의 UTC 날짜 문자열

    Returns:
        int: 밀리초 단위 타임스탬프 (예: 1640995200000)
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def get_user_requested_range(start_date, end_date):
    """
    전역 설정된 사용자 요청 기간을 타임스탬프로 변환하여 반환
    미래 날짜는 현재 시간으로 자동 조정

    Args:
        start_date (str): UTC 기준 시작 날짜 (YYYY-MM-DD)
        end_date (str): UTC 기준 종료 날짜 (YYYY-MM-DD)

    Returns:
        tuple: (시작_타임스탬프, 종료_타임스탬프) 밀리초 단위
    """
    start_ts = convert_date_to_timestamp(start_date)
    end_ts = convert_date_to_timestamp(end_date)

    print(f"{start_ts} ~ {end_ts}")

    # 현재 UTC 시간 확인하여 미래 날짜 방지
    current_time = int(datetime.now(timezone.utc).timestamp() * 1000)

    if end_ts > current_time:
        print(f"⚠️ 종료 날짜가 미래로 설정되어 있습니다. 현재 UTC 시간으로 조정합니다.")
        print(
            f"   설정값: {end_date} → 조정값: {datetime.fromtimestamp(current_time/1000, tz=timezone.utc).strftime('%Y-%m-%d')}"
        )
        end_ts = current_time

    return start_ts, end_ts


def get_db_connection():
    """
    SQLite 데이터베이스 연결 객체 생성

    Returns:
        sqlite3.Connection: DB 연결 객체
    """
    return sqlite3.connect(DB_PATH)


def create_tables_if_not_exist():
    """
    모든 시간봉 테이블이 존재하지 않으면 자동 생성
    각 테이블은 OHLCV 데이터 구조로 생성됨
    - timestamp: 밀리초 타임스탬프 (PRIMARY KEY, UTC 기준)
    - open, high, low, close: 가격 데이터 (REAL)
    - volume: 거래량 (REAL)
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # TIMEFRAME_CONFIG에 정의된 모든 테이블 순회하여 생성
    for table_name in TIMEFRAME_CONFIG.keys():
        create_table_sql = f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            timestamp INTEGER PRIMARY KEY,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume REAL NOT NULL
        )
        """
        cursor.execute(create_table_sql)

        # 타임스탬프 컬럼에 인덱스 생성 (검색 성능 대폭 향상)
        cursor.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{table_name}_timestamp ON {table_name}(timestamp)"
        )

    conn.commit()  # 모든 변경사항 커밋
    conn.close()  # 연결 정리
    print("✅ 테이블 생성/확인 완료")


def get_binance_klines(symbol, interval, start_time, end_time, limit=1000):
    """
    Binance REST API를 통해 캔들스틱 데이터 요청

    Args:
        symbol (str): 거래 심볼 (예: 'BTCUSDT')
        interval (str): 시간 간격 (예: '1m', '5m', '1h', '1d')
        start_time (int): 시작 시간 (밀리초 타임스탬프, UTC)
        end_time (int): 종료 시간 (밀리초 타임스탬프, UTC)
        limit (int): 최대 가져올 캔들 개수 (기본값: 1000, 최대: 1000)

    Returns:
        list or None: 성공 시 캔들 데이터 리스트, 실패 시 None
                      각 캔들: [open_time, open, high, low, close, volume, ...]
    """
    # API 요청 파라미터 구성
    params = {
        "symbol": symbol,  # 거래쌍
        "interval": interval,  # 시간봉 간격
        "startTime": start_time,  # 시작 시간 (밀리초, UTC)
        "endTime": end_time,  # 종료 시간 (밀리초, UTC)
        "limit": limit,  # 최대 개수
    }

    try:
        # HTTP GET 요청 (타임아웃 10초)
        response = requests.get(BINANCE_API_URL, params=params, timeout=10)
        response.raise_for_status()  # HTTP 에러 발생 시 예외 발생
        return response.json()  # JSON 응답 파싱하여 반환
    except requests.exceptions.RequestException as e:
        print(f"❌ API 요청 오류: {e}")
        # 추가 디버그 정보 출력
        if hasattr(e, "response") and e.response is not None:
            print(f"   HTTP 상태 코드: {e.response.status_code}")
            try:
                error_data = e.response.json()
                print(f"   에러 메시지: {error_data}")
            except:
                print(f"   응답 내용: {e.response.text[:200]}")
        print(f"   요청 URL: {BINANCE_API_URL}")
        print(f"   파라미터: {params}")
        return None


def save_klines_to_db(table_name, klines_data):
    """
    Binance API에서 받은 캔들 데이터를 SQLite DB에 저장

    Args:
        table_name (str): 저장할 테이블명 (예: 'ohlcv_1m')
        klines_data (list): Binance API 응답 캔들 데이터 리스트

    Returns:
        int: 실제 저장된 캔들 개수
    """
    if not klines_data:
        return 0

    conn = get_db_connection()
    cursor = conn.cursor()

    # INSERT OR REPLACE: 동일한 타임스탬프가 있으면 덮어쓰기 (중복 방지)
    insert_sql = f"""
    INSERT OR REPLACE INTO {table_name} 
    (timestamp, open, high, low, close, volume) 
    VALUES (?, ?, ?, ?, ?, ?)
    """

    saved_count = 0
    # Binance API 응답 구조: [open_time, open, high, low, close, volume, close_time, ...]
    for kline in klines_data:
        try:
            timestamp = int(kline[0])  # 캔들 시작 시간 (밀리초, UTC)
            open_price = float(kline[1])  # 시가
            high_price = float(kline[2])  # 고가
            low_price = float(kline[3])  # 저가
            close_price = float(kline[4])  # 종가
            volume = float(kline[5])  # 거래량

            cursor.execute(
                insert_sql,
                (timestamp, open_price, high_price, low_price, close_price, volume),
            )
            saved_count += 1
        except (ValueError, IndexError) as e:
            print(f"⚠️ 데이터 변환 오류: {e}")
            continue  # 오류 발생한 캔들은 건너뛰고 계속 진행

    conn.commit()  # 모든 변경사항 데이터베이스에 저장
    conn.close()  # 연결 정리
    return saved_count


def get_table_data_range(table_name):
    """
    특정 테이블의 데이터 범위와 개수 조회

    Args:
        table_name (str): 조회할 테이블명

    Returns:
        tuple: (최소_타임스탬프, 최대_타임스탬프, 총_개수)
               데이터가 없으면 (None, None, 0)
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # 총 데이터 개수 조회
    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    count = cursor.fetchone()[0]

    if count == 0:
        conn.close()
        return None, None, 0

    # 최소/최대 타임스탬프 조회 (데이터 범위 확인)
    cursor.execute(f"SELECT MIN(timestamp), MAX(timestamp) FROM {table_name}")
    min_ts, max_ts = cursor.fetchone()

    conn.close()
    return min_ts, max_ts, count


def check_user_requested_data_exists(table_name, start_ts, end_ts):
    """
    사용자가 요청한 특정 기간의 데이터 존재 여부 확인

    Args:
        table_name (str): 확인할 테이블명
        start_ts (int): 시작 타임스탬프 (밀리초, UTC)
        end_ts (int): 종료 타임스탬프 (밀리초, UTC)

    Returns:
        bool: 해당 기간에 데이터가 있으면 True, 없으면 False
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # 지정된 기간 내 데이터 개수 조회
    cursor.execute(
        f"""
        SELECT COUNT(*) FROM {table_name} 
        WHERE timestamp >= ? AND timestamp <= ?
    """,
        (start_ts, end_ts),
    )

    count = cursor.fetchone()[0]
    conn.close()
    return count > 0


def get_missing_data_ranges(table_name, start_ts, end_ts, interval_ms):
    """
    사용자 요청 기간에서 누락된 데이터 범위를 찾아서 연속된 구간으로 그룹화

    Args:
        table_name (str): 확인할 테이블명
        start_ts (int): 시작 타임스탬프 (밀리초, UTC)
        end_ts (int): 종료 타임스탬프 (밀리초, UTC)
        interval_ms (int): 시간봉 간격 (밀리초 단위)

    Returns:
        list: 누락된 데이터 범위 리스트 [(시작시간, 종료시간), ...]
              연속된 누락 구간은 하나의 범위로 그룹화됨
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # DB에 실제 존재하는 타임스탬프들을 조회 (요청 기간 내에서만)
    cursor.execute(
        f"""
        SELECT timestamp FROM {table_name} 
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp
    """,
        (start_ts, end_ts),
    )

    existing_timestamps = set(row[0] for row in cursor.fetchall())
    conn.close()

    # 요청 기간 내에서 예상되는 모든 타임스탬프 생성
    # 시간봉 간격에 따라 정확한 시점들을 계산
    expected_timestamps = []
    current_time = start_ts
    while current_time <= end_ts:
        expected_timestamps.append(current_time)
        current_time += interval_ms  # 다음 시간봉으로 이동

    # 예상되는 타임스탬프 중 실제 DB에 없는 것들 찾기
    missing_timestamps = [
        ts for ts in expected_timestamps if ts not in existing_timestamps
    ]

    # 연속된 누락 타임스탬프들을 하나의 범위로 그룹화
    # 예: [100, 101, 102, 105, 106] → [(100,102), (105,106)]
    missing_ranges = []
    if missing_timestamps:
        range_start = missing_timestamps[0]
        range_end = missing_timestamps[0]

        for ts in missing_timestamps[1:]:
            if ts == range_end + interval_ms:
                range_end = ts
            else:
                missing_ranges.append((range_start, range_end))
                range_start = ts
                range_end = ts
        missing_ranges.append((range_start, range_end))

    return missing_ranges


def find_missing_timestamps(table_name, start_time, end_time, interval_ms):
    """
    누락된 타임스탬프 찾기

    Args:
        table_name (str): 테이블명
        start_time (int): 시작 시간 (밀리초, UTC)
        end_time (int): 종료 시간 (밀리초, UTC)
        interval_ms (int): 시간봉 간격 (밀리초)

    Returns:
        list: 누락된 타임스탬프 리스트
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # DB에 있는 타임스탬프 조회
    cursor.execute(
        f"""
        SELECT timestamp FROM {table_name} 
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp
    """,
        (start_time, end_time),
    )

    existing_timestamps = set(row[0] for row in cursor.fetchall())
    conn.close()

    # 예상되는 모든 타임스탬프 생성
    expected_timestamps = []
    current_time = start_time
    while current_time <= end_time:
        expected_timestamps.append(current_time)
        current_time += interval_ms

    # 누락된 타임스탬프 찾기
    missing_timestamps = [
        ts for ts in expected_timestamps if ts not in existing_timestamps
    ]
    return missing_timestamps


def format_timestamp(timestamp_ms):
    """
    타임스탬프를 UTC 기준 읽기 쉬운 형태로 변환

    Args:
        timestamp_ms (int): 밀리초 타임스탬프

    Returns:
        str: UTC 기준 날짜/시간 문자열 (YYYY-MM-DD HH:MM:SS UTC)
    """
    timestamp_s = timestamp_ms / 1000
    utc_datetime = datetime.fromtimestamp(timestamp_s, tz=timezone.utc)
    result_utc = utc_datetime.strftime("%Y-%m-%d %H:%M:%S UTC")
    return result_utc


# =============================================================================
# 메인 동기화 함수
# =============================================================================
def sync_user_requested_data(table_name, config):
    """
    사용자가 요청한 특정 기간의 데이터를 확인하고 누락된 부분을 Binance에서 가져와 보완

    주요 동작:
    1. 사용자 설정 기간(START_DATE ~ END_DATE, UTC) 내 누락 데이터 찾기
    2. 누락된 구간을 연속 범위로 그룹화
    3. 각 범위별로 Binance API에서 데이터 가져오기
    4. 대용량 구간은 1000개씩 배치 처리

    Args:
        table_name (str): 동기화할 테이블명 (예: 'ohlcv_1m')
        config (dict): 해당 시간봉 설정 정보 (interval, milliseconds, description)
    """
    print(
        f"\n🔄 {table_name} ({config['description']}) - 사용자 요청 기간 동기화 시작..."
    )

    # 전역 설정에서 사용자 요청 기간을 타임스탬프로 변환
    start_ts, end_ts = get_user_requested_range(START_DATE, END_DATE)
    print(
        f"   🎯 요청 기간(UTC): {format_timestamp(start_ts)} ~ {format_timestamp(end_ts)}"
    )

    # 요청 기간 내에서 누락된 데이터 구간들을 찾기
    missing_ranges = get_missing_data_ranges(
        table_name, start_ts, end_ts, config["milliseconds"]
    )

    if not missing_ranges:
        print(f"   ✅ 요청 기간의 모든 데이터가 이미 존재함")
        return

    print(f"   ⚠️ 누락된 데이터 범위: {len(missing_ranges)}개")

    # 각 누락 범위별로 순차적으로 데이터 가져오기
    total_saved = 0
    for i, (range_start, range_end) in enumerate(missing_ranges, 1):
        print(
            f"   📥 [{i}/{len(missing_ranges)}] {format_timestamp(range_start)} ~ {format_timestamp(range_end)} 가져오는 중..."
        )

        # 큰 범위는 Binance API 제한(1000개)에 맞게 배치 처리
        current_start = range_start
        while current_start <= range_end:
            # 다음 배치의 종료 시간 계산 (최대 1000개 캔들까지)
            current_end = min(
                current_start + (MAX_KLINES_PER_REQUEST * config["milliseconds"]),
                range_end + config["milliseconds"],
            )

            # Binance REST API 호출하여 캔들 데이터 요청
            klines = get_binance_klines(
                SYMBOL,  # 거래쌍 (BTCUSDT)
                config["interval"],  # 시간봉 간격 (1m, 5m, 1h 등)
                current_start,  # 배치 시작 시간 (UTC)
                current_end,  # 배치 종료 시간 (UTC)
                MAX_KLINES_PER_REQUEST,  # 최대 1000개
            )

            if klines:
                saved_count = save_klines_to_db(table_name, klines)
                total_saved += saved_count
                if saved_count > 0:
                    head_time = format_timestamp(int(klines[0][0]))
                    print(f"{head_time} : {SYMBOL} 💾 {saved_count}개 저장)")
                else:
                    print(f"{head_time} : {SYMBOL} 💾 {saved_count}개 저장")
            else:
                print(
                    f"       ⚠️ API 요청 실패 ({format_timestamp(current_start)} ~ {format_timestamp(current_end)})"
                )

            # API 제한 대응
            time.sleep(API_DELAY)

            # 다음 배치로
            current_start = current_end

    print(f"   ✅ 완료: 총 {total_saved:,}개 데이터 저장")


def sync_table_data(table_name, config):
    """
    특정 테이블의 최신 데이터를 현재 UTC 시간까지 업데이트

    주요 동작:
    1. 기존 데이터의 마지막 시간을 확인
    2. 마지막 데이터 다음부터 현재 UTC 시간까지 동기화
    3. MAX_UPDATE_DAYS 제한으로 과도한 업데이트 방지
    4. 배치 단위로 API 호출하여 안전하게 처리

    Args:
        table_name (str): 업데이트할 테이블명
        config (dict): 시간봉 설정 정보 (interval, milliseconds, description)
    """
    # UPDATE_TO_CURRENT 설정이 비활성화된 경우 건너뛰기
    if not UPDATE_TO_CURRENT:
        print(
            f"\n🔄 {table_name} ({config['description']}) - 최신 데이터 업데이트 스킵 (설정: UPDATE_TO_CURRENT=False)"
        )
        return

    print(f"\n🔄 {table_name} ({config['description']}) - 최신 데이터 동기화 시작...")

    # 테이블의 현재 데이터 범위와 개수 확인
    min_ts, max_ts, count = get_table_data_range(table_name)

    if count == 0:
        print(f"   📊 빈 테이블 - 사용자 요청 기간 데이터로 초기화됨")
        return

    print(f"   📊 기존 데이터: {count:,}개")
    print(f"   📅 범위(UTC): {format_timestamp(min_ts)} ~ {format_timestamp(max_ts)}")

    # 동기화 범위 계산: 마지막 데이터 다음부터 현재 UTC 시간까지
    current_time = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_time = max_ts + config["milliseconds"]  # 마지막 데이터 다음 시간봉부터

    # 최대 업데이트 일수 제한 적용 (API 부하 및 시간 절약)
    max_update_time = max_ts + (MAX_UPDATE_DAYS * 24 * 60 * 60 * 1000)
    end_time = min(current_time, max_update_time)

    # 이미 최신 상태인지 확인
    if start_time >= end_time:
        print(f"   ✅ 최신 상태 - 동기화 불필요")
        return

    # 업데이트 범위 제한 경고 메시지
    if end_time < current_time:
        days_limited = (current_time - end_time) / (24 * 60 * 60 * 1000)
        print(
            f"   ⚠️ 업데이트 범위 제한됨 (최대 {MAX_UPDATE_DAYS}일, {days_limited:.1f}일 제외)"
        )

    print(
        f"   🎯 동기화 범위(UTC): {format_timestamp(start_time)} ~ {format_timestamp(end_time)}"
    )

    # 동기화할 데이터를 배치 단위로 순차 처리
    total_saved = 0
    current_start = start_time

    while current_start < end_time:
        # 다음 배치의 종료 시간 계산 (API 제한 고려)
        current_end = min(
            current_start + (MAX_KLINES_PER_REQUEST * config["milliseconds"]), end_time
        )

        print(
            f"   📥 {format_timestamp(current_start)} ~ {format_timestamp(current_end)} 요청중..."
        )

        # Binance REST API 호출하여 최신 캔들 데이터 가져오기
        klines = get_binance_klines(
            SYMBOL,  # 거래쌍 (BTCUSDT)
            config["interval"],  # 시간봉 간격
            current_start,  # 배치 시작 시간 (UTC)
            current_end,  # 배치 종료 시간 (UTC)
            MAX_KLINES_PER_REQUEST,  # 최대 1000개 제한
        )

        if klines:
            saved_count = save_klines_to_db(table_name, klines)
            total_saved += saved_count

            head_time = format_timestamp(int(klines[0][0]))
            print(f"{head_time} : {SYMBOL} 💾 {saved_count}개 저장)")
        else:
            print(
                f"   ⚠️ API 요청 실패 ({format_timestamp(current_start)} ~ {format_timestamp(current_end)})"
            )

        # API 제한 대응을 위한 요청 간 지연
        time.sleep(API_DELAY)

        # 다음 배치로 이동
        current_start = current_end + config["milliseconds"]

    print(f"   ✅ 완료: 총 {total_saved:,}개 데이터 저장")


def check_data_integrity(table_name, config):
    """
    데이터 무결성 확인 및 누락된 데이터 복구

    주요 동작:
    1. 최근 24시간 범위의 데이터 연속성 확인
    2. 누락된 타임스탬프 탐지 (시간봉 간격 기준)
    3. 연속된 누락 구간을 범위로 그룹화
    4. 각 누락 범위별로 Binance에서 데이터 복구

    Args:
        table_name (str): 무결성을 확인할 테이블명
        config (dict): 시간봉 설정 정보 (milliseconds로 간격 확인)
    """
    print(f"\n🔍 {table_name} 데이터 무결성 확인...")

    # 테이블의 현재 데이터 범위 확인
    min_ts, max_ts, count = get_table_data_range(table_name)

    if count == 0:
        print(f"   ℹ️ 빈 테이블 - 건너뜀")
        return

    # 성능을 위해 최근 24시간만 확인 (전체 확인은 시간이 오래 걸림)
    check_end = max_ts
    check_start = max(min_ts, check_end - (24 * 60 * 60 * 1000))  # 24시간 전

    print(
        f"   🔍 무결성 확인 범위(UTC): {format_timestamp(check_start)} ~ {format_timestamp(check_end)}"
    )

    # 지정된 범위에서 누락된 타임스탬프들을 찾기
    missing_timestamps = find_missing_timestamps(
        table_name, check_start, check_end, config["milliseconds"]
    )

    if not missing_timestamps:
        print(f"   ✅ 데이터 무결성 양호")
        return

    print(f"   ⚠️ 누락된 데이터: {len(missing_timestamps)}개")

    # 연속된 누락 타임스탬프들을 범위로 그룹화 (API 효율성 향상)
    missing_ranges = []
    if missing_timestamps:
        range_start = missing_timestamps[0]
        range_end = missing_timestamps[0]

        # 연속된 타임스탬프들을 하나의 범위로 묶기
        for ts in missing_timestamps[1:]:
            if ts == range_end + config["milliseconds"]:  # 다음 연속 시간봉
                range_end = ts
            else:  # 연속이 끊어진 경우 새로운 범위 시작
                missing_ranges.append((range_start, range_end))
                range_start = ts
                range_end = ts
        missing_ranges.append((range_start, range_end))  # 마지막 범위 추가

    # 각 누락 범위별로 데이터 복구 작업 수행
    total_recovered = 0
    for range_start, range_end in missing_ranges:
        print(
            f"   🔧 복구중: {format_timestamp(range_start)} ~ {format_timestamp(range_end)}"
        )

        # Binance API로 누락된 범위의 캔들 데이터 요청
        klines = get_binance_klines(
            SYMBOL,  # 거래쌍
            config["interval"],  # 시간봉 간격
            range_start,  # 복구 시작 시간 (UTC)
            range_end + config["milliseconds"],  # 복구 종료 시간 (포함, UTC)
            MAX_KLINES_PER_REQUEST,  # 최대 1000개 제한
        )

        if klines:
            saved_count = save_klines_to_db(table_name, klines)
            total_recovered += saved_count
            print(f"   💾 {saved_count}개 복구")
        else:
            print(
                f"   ⚠️ API 요청 실패 ({format_timestamp(range_start)} ~ {format_timestamp(range_end + config['milliseconds'])})"
            )

        # API 제한 대응 지연
        time.sleep(API_DELAY)

    print(f"   ✅ 무결성 확인 완료: {total_recovered}개 데이터 복구")


def show_database_status():
    """
    데이터베이스 전체 상태 요약 출력 (UTC 기준)

    각 시간봉 테이블의 현재 데이터 개수와 UTC 날짜 범위를 표시하여
    사용자가 현재 상태를 한눈에 파악할 수 있도록 도움
    """
    print(f"\n{'='*70}")
    print(f"📊 데이터베이스 상태 요약 (UTC 기준)")
    print(f"{'='*70}")

    # 각 시간봉 테이블의 상태를 순차적으로 확인하고 출력
    for table_name, config in TIMEFRAME_CONFIG.items():
        min_ts, max_ts, count = get_table_data_range(table_name)

        if count == 0:
            print(f"{config['description']:>8}: 데이터 없음")
        else:
            start_date = format_timestamp(min_ts)
            end_date = format_timestamp(max_ts)
            print(
                f"{config['description']:>8}: {count:,}개 | {start_date} ~ {end_date}"
            )


def sync_historical_data():
    """
    사용자 요청 기간(UTC)의 누락된 데이터만 완전히 동기화하는 함수 (실시간 업데이트 제외)

    주요 기능:
    1. 데이터베이스 및 테이블 초기화
    2. 기존 데이터 무결성 확인 및 복구
    3. 사용자 요청 기간(START_DATE ~ END_DATE, UTC)의 누락 데이터만 보완
    4. 실시간/최신 데이터 업데이트는 하지 않음

    Note:
        최신 데이터가 필요하면 continuous_update_mode() 함수를 별도 실행

    Returns:
        bool: 성공적으로 완료되면 True, 오류 발생 시 False
    """
    print(f"{'='*70}")
    print(f"📥 사용자 요청 기간 데이터 동기화 시작 (UTC 기준)")
    print(f"{'='*70}")
    print(f"심볼: {SYMBOL}")
    print(f"데이터베이스: {DB_PATH}")
    print(f"요청 기간(UTC): {START_DATE} ~ {END_DATE}")
    print(f"최신 데이터 업데이트: {'활성화' if UPDATE_TO_CURRENT else '비활성화'}")
    if UPDATE_TO_CURRENT:
        print(f"최대 업데이트 일수: {MAX_UPDATE_DAYS}일")
    print(f"{'='*70}")

    try:
        # Phase 1: 데이터베이스 초기화
        if not db_exists():
            print(f"\n📄 DB 파일이 없습니다. 새로 생성합니다.")
            create_tables_if_not_exist()
        else:
            print(f"\n📄 기존 DB 파일을 사용합니다.")
            create_tables_if_not_exist()
            show_database_status()

        # Phase 2: 기존 데이터 무결성 확인
        print(f"\n{'='*70}")
        print(f"🔍 기존 데이터 무결성 확인 시작")
        print(f"{'='*70}")

        for table_name, config in TIMEFRAME_CONFIG.items():
            try:
                check_data_integrity(table_name, config)
            except Exception as e:
                print(f"❌ {table_name} 무결성 확인 오류: {e}")
                continue

        # Phase 3: 사용자 요청 기간 데이터 보완
        print(f"\n{'='*70}")
        print(f"📥 사용자 요청 기간 데이터 확인 및 보완 (UTC)")
        print(f"{'='*70}")

        for table_name, config in TIMEFRAME_CONFIG.items():
            try:
                sync_user_requested_data(table_name, config)
            except Exception as e:
                print(f"❌ {table_name} 사용자 데이터 확인 오류: {e}")
                continue

        # Phase 4: 최종 상태 출력
        show_database_status()

        print(f"\n{'='*70}")
        print(f"✅ 사용자 요청 기간 데이터 동기화 완료!")
        print(f"{'='*70}")
        print(f"💡 사용자 지정 기간(UTC): {START_DATE} ~ {END_DATE}")
        print(
            f"💡 최신 데이터가 필요하면 continuous_update_mode() 함수를 별도로 실행하세요."
        )
        return True

    except Exception as e:
        print(f"\n❌ 데이터 동기화 중 오류 발생: {e}")
        return False


def continuous_update_mode():
    """
    설정된 간격으로 최신 데이터를 지속적으로 업데이트하는 함수

    주요 기능:
    1. 무한 루프로 실시간 데이터 추적
    2. 설정된 간격(UPDATE_INTERVAL)마다 최신 데이터 갱신
    3. Ctrl+C로 안전하게 종료 가능
    4. 각 업데이트 후 데이터베이스 상태 출력

    Note:
        이 함수는 CONTINUOUS_UPDATE=True이고 UPDATE_TO_CURRENT=True일 때만 동작
    """
    if not (UPDATE_TO_CURRENT and CONTINUOUS_UPDATE):
        print(f"\n💡 지속적 업데이트가 비활성화되어 있습니다.")
        print(
            f"   활성화하려면: UPDATE_TO_CURRENT=True, CONTINUOUS_UPDATE=True로 설정하세요."
        )
        return

    print(f"\n{'='*70}")
    print(f"🔄 지속적 업데이트 모드 시작 ({UPDATE_INTERVAL}초 간격, UTC 기준)")
    print(f"{'='*70}")
    print(f"💡 중지하려면 Ctrl+C를 누르세요")
    print(f"💡 이 모드는 실시간으로 최신 가격 데이터를 추적합니다")
    print(f"{'='*70}")

    try:
        # 무한 루프로 지속적 업데이트 실행
        update_count = 0
        while True:
            print(f"\n⏱️ {UPDATE_INTERVAL}초 대기 중...")
            time.sleep(UPDATE_INTERVAL)

            update_count += 1
            current_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            print(f"\n{'='*70}")
            print(f"🔄 최신 데이터 업데이트 #{update_count} ({current_time})")
            print(f"{'='*70}")

            # 모든 시간봉 테이블의 최신 데이터만 업데이트
            update_success = True
            for table_name, config in TIMEFRAME_CONFIG.items():
                try:
                    sync_table_data(table_name, config)
                except Exception as e:
                    print(f"❌ {table_name} 최신 데이터 동기화 오류: {e}")
                    update_success = False
                    continue

            # 업데이트 후 데이터베이스 상태 출력
            show_database_status()

            if update_success:
                print(f"✅ 업데이트 #{update_count} 완료")
            else:
                print(f"⚠️ 업데이트 #{update_count} 일부 오류 발생")

    except KeyboardInterrupt:
        print(f"\n\n{'='*70}")
        print(f"⏹️ 사용자에 의해 중지되었습니다")
        print(f"⏹️ 총 {update_count}회 업데이트 실행됨")
        print(f"{'='*70}")
    except Exception as e:
        print(f"\n❌ 지속적 업데이트 중 오류 발생: {e}")
        print(f"⏹️ 총 {update_count}회 업데이트 실행됨")


# =============================================================================
# 메인 실행 함수
# =============================================================================
def main():
    """
    프로그램 메인 실행 함수 (통합 모드, UTC 기준)

    기존 방식과 동일하게 동작하며 내부적으로 분리된 함수들을 호출:
    1. sync_historical_data(): 사용자 요청 기간 데이터 동기화 (UTC)
    2. continuous_update_mode(): 지속적 실시간 업데이트 (옵션)
    """
    print(f"{'='*70}")
    print(f"🚀 Binance OHLCV 데이터 동기화 프로그램 (UTC 기준)")
    print(f"{'='*70}")

    # SYMBOL_LIST로 for문 돌려
    for symbol in SYMBOL_LIST:
        global DB_PATH, SYMBOL
        SYMBOL = symbol.replace("/", "")
        DB_PATH = f"binance_ohlcv_{SYMBOL}.db"
        print(f"SYMBOL : {SYMBOL}  DB : {DB_PATH} 데이터 동기화 시작")

        # Step 1: 사용자 요청 기간 데이터 동기화 실행
        success = sync_historical_data()
        if not success:
            print(f"\n❌ 초기 데이터 동기화에 실패했습니다.")
            print(f"💡 프로그램을 종료합니다.")
            return

        # Step 2: 지속적 업데이트 모드 실행 (설정에 따라)
        continuous_update_mode()

        # Step 3: 프로그램 완료 안내
        print(f"\n{'='*70}")
        print(f"✅ 프로그램 실행 완료!")
        print(f"{'='*70}")
        print(f"💡 사용자 요청 기간(UTC): {START_DATE} ~ {END_DATE}")
        print(
            f"   최신 데이터 업데이트: {'활성화' if UPDATE_TO_CURRENT else '비활성화'}"
        )
        if UPDATE_TO_CURRENT:
            print(f"   최대 업데이트 일수: {MAX_UPDATE_DAYS}일")
            print(
                f"   지속적 업데이트: {'활성화' if CONTINUOUS_UPDATE else '비활성화'}"
            )
        else:
            print(f"   ✨ 최신 데이터가 필요하면 UPDATE_TO_CURRENT = True로 설정하세요")
        print(
            f"   프로그램을 주기적으로 실행하면 자동으로 최신 데이터가 업데이트됩니다."
        )
        print(f"   권장: 1시간마다 실행 (cron job 또는 스케줄러 사용)")
        print(f"{'='*70}\n")


# =============================================================================
# 프로그램 진입점
# =============================================================================
if __name__ == "__main__":
    """
    프로그램 직접 실행 시 메인 함수 호출

    이 프로그램은 다음과 같은 방식으로 실행할 수 있습니다:
    1. 직접 실행: python binance_ohlcv_sync_utc.py
    2. 모듈 임포트: import binance_ohlcv_sync_utc; binance_ohlcv_sync_utc.main()
    3. 스케줄러 연동: 주기적 자동 실행

    새로운 분리된 함수 사용법:
    - sync_historical_data(): 사용자 요청 기간 데이터 동기화만 실행
    - continuous_update_mode(): 설정된 간격으로 실시간 업데이트만 실행
    - main(): 기존과 동일한 통합 모드

    ⏰ 모든 시간은 UTC 기준입니다
    """
    main()
