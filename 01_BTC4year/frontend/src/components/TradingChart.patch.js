/**
 * TradingChart.jsx 수정 가이드
 * 
 * 1) import 변경:
 *    - 삭제: import { supabase } from '../lib/supabase'
 *    + 추가: import { fetchOhlcvData } from '../lib/api'
 * 
 * 2) loadData 함수 변경 (기존 144~207 라인을 아래로 교체):
 */

// ─── 변경 전 (삭제) ──────────────────────────────────
// import { supabase } from '../lib/supabase'
//
// const loadData = useCallback(async () => {
//   try {
//     setLoading(true)
//     let allData = []
//     let offset = 0
//     const batchSize = 1000
//     while (true) {
//       const { data, error: fetchError } = await supabase
//         .from('ohlcv_1day')
//         .select(...)
//       ...
//     }
//     ...
//   }
// }, [])

// ─── 변경 후 (추가) ──────────────────────────────────
import { fetchOhlcvData } from '../lib/api'

const loadData = useCallback(async () => {
  try {
    setLoading(true)
    
    // Backend API에서 OHLCV 데이터 조회
    const result = await fetchOhlcvData()
    const allData = result.data || []

    if (allData.length === 0) throw new Error('데이터 없음')

    const candleData = allData.map(d => ({
      time:  d.readable_time.split('T')[0],
      open:  d.open,
      high:  d.high,
      low:   d.low,
      close: d.close,
    }))

    const volumeData = allData.map(d => ({
      time:  d.readable_time.split('T')[0],
      value: d.volume,
      color: d.close >= d.open ? '#0ECB8180' : '#F6465D80',
    }))

    setChartData({
      candleData,
      volumeData,
      maData: {
        ma20:  calculateMA(candleData, 20),
        ma50:  calculateMA(candleData, 50),
        ma200: calculateMA(candleData, 200),
      },
      rsiData:  calculateRSI(candleData),
      macdData: calculateMACD(candleData),
    })

    const last = candleData.at(-1)
    setCurrentPrice(last.close)
    if (candleData.length > 1) {
      const prev = candleData.at(-2).close
      setPriceChange(((last.close - prev) / prev) * 100)
    }
    setLoading(false)
  } catch (err) {
    console.error('데이터 로드 실패:', err.message)
    setError(err.message)
    setLoading(false)
  }
}, [])
