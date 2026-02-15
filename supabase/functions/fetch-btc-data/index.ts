import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  try {
    // 1. Supabase 클라이언트 초기화
    // Deno 환경변수에서 URL과 Service Role Key를 자동으로 가져옵니다.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 2. 바이낸스 API 호출 (최근 7일치 데이터)
    // BTC/USDT, 1일봉(1d), 최근 7개(limit=7)
    const binanceRes = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=7')
    
    if (!binanceRes.ok) {
      throw new Error(`Binance API error: ${binanceRes.statusText}`)
    }
    
    const candles = await binanceRes.json()

    // 3. 데이터 가공 (사용자님의 새 테이블 스키마에 맞춤)
    const rowsToUpsert = candles.map((candle: any[]) => {
      const msTimestamp = candle[0]; // 바이낸스 제공 밀리초 타임스탬프
      
      return {
        timestamp: msTimestamp,                                // bigint
        readable_time: new Date(msTimestamp).toISOString(),    // timestamptz (UTC ISO 8601)
        open: parseFloat(candle[1]),                           // double precision
        high: parseFloat(candle[2]),                           // double precision
        low: parseFloat(candle[3]),                            // double precision
        close: parseFloat(candle[4]),                          // double precision
        volume: parseFloat(candle[5])                          // double precision
      }
    })

    // 4. 데이터베이스 Upsert 실행
    // timestamp가 겹치면 업데이트, 없으면 새로 삽입
    const { data, error } = await supabase
      .from('ohlcv_1day')
      .upsert(rowsToUpsert, { onConflict: 'timestamp' })

    if (error) throw error

    // 5. 성공 응답 반환
    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "7 days of BTC data synced successfully", 
        count: rowsToUpsert.length,
        last_updated: new Date().toISOString()
      }), 
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    )

  } catch (err) {
    // 에러 발생 시 응답
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: err.message 
      }), 
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }
    )
  }
})