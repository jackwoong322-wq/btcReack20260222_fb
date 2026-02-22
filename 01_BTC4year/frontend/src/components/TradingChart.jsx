import { useState, useEffect, useRef, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import { fetchOhlcvData } from '../lib/api'
import { useResizeChart } from '../hooks/useResizeChart'
import '../styles/Chart.css'

/* ─── 지표 계산 ─────────────────────────────────────── */

function calculateMA(data, period) {
  const ma = []
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) sum += data[i - j].close
    ma.push({ time: data[i].time, value: sum / period })
  }
  return ma
}

function calculateEMA(data, period) {
  const multiplier = 2 / (period + 1)
  const ema = []
  let sum = 0
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i].value ?? data[i].close
  }
  let prev = sum / period
  for (let i = period - 1; i < data.length; i++) {
    const val = data[i].value ?? data[i].close
    const cur = (val - prev) * multiplier + prev
    ema.push({ time: data[i].time, value: cur })
    prev = cur
  }
  return ema
}

function calculateRSI(data, period = 14) {
  const changes = data.slice(1).map((d, i) => d.close - data[i].close)
  const rsi = []
  for (let i = period; i < changes.length; i++) {
    const slice = changes.slice(i - period, i)
    const gains = slice.filter(c => c > 0)
    const losses = slice.filter(c => c < 0).map(Math.abs)
    const avgGain = gains.reduce((a, b) => a + b, 0) / period
    const avgLoss = losses.reduce((a, b) => a + b, 0) / period
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    if (data[i + 1]) rsi.push({ time: data[i + 1].time, value: 100 - 100 / (1 + rs) })
  }
  return rsi
}

function calculateMACD(data) {
  const emaFast = calculateEMA(data, 12)
  const emaSlow = calculateEMA(data, 26)
  const len = Math.min(emaFast.length, emaSlow.length)
  const macdLine = Array.from({ length: len }, (_, i) => ({
    time: emaFast[i].time,
    value: emaFast[i].value - emaSlow[i].value,
  }))
  const signal = calculateEMA(macdLine, 9)
  const timeSet = new Set(signal.map(s => s.time))
  const histogram = macdLine
    .filter(m => timeSet.has(m.time))
    .map(m => {
      const sig = signal.find(s => s.time === m.time)
      return {
        time: m.time,
        value: m.value - sig.value,
        color: m.value >= sig.value ? '#0ECB81' : '#F6465D',
      }
    })
  return { macdLine, signal, histogram }
}

/* ─── 차트 옵션 기본값 ──────────────────────────────── */

const BASE_CHART_OPTIONS = {
  layout: {
    background: { color: '#0B0E11' },
    textColor: '#848E9C',
  },
  localization: { dateFormat: 'yyyy-MM-dd' },
  grid: {
    vertLines: { color: '#1C2127' },
    horzLines: { color: '#1C2127' },
  },
  crosshair: {
    mode: 1,
    vertLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2B3139' },
    horzLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2B3139' },
  },
  rightPriceScale: { borderColor: '#2B3139' },
  timeScale: {
    borderColor: '#2B3139',
    textColor: '#848E9C',
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 5,
    barSpacing: 1,
    minBarSpacing: 0.5,
    fixLeftEdge: true,
    fixRightEdge: true,
  },
  handleScroll: {
    mouseWheel: true,
    pressedMouseMove: true,
    horzTouchDrag: true,
    vertTouchDrag: true,
  },
  handleScale: {
    axisPressedMouseMove: true,
    mouseWheel: true,
    pinch: true,
  },
}

/* ─── 컴포넌트 ──────────────────────────────────────── */

export default function TradingChart() {
  // 차트 컨테이너 refs
  const mainContainerRef  = useRef(null)
  const volContainerRef   = useRef(null)
  const rsiContainerRef   = useRef(null)
  const macdContainerRef  = useRef(null)

  // 차트 인스턴스 refs
  const mainChartRef = useRef(null)
  const volChartRef  = useRef(null)
  const rsiChartRef  = useRef(null)
  const macdChartRef = useRef(null)

  const [showMA, setShowMA]             = useState({ ma20: true, ma50: true, ma200: true })
  const [currentPrice, setCurrentPrice] = useState(null)
  const [priceChange, setPriceChange]   = useState(null)
  const [chartData, setChartData]       = useState(null)
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)

  /* ResizeObserver 기반 반응형 — 메인 컨테이너 감시 */
  useResizeChart(
    mainContainerRef,
    [mainChartRef, volChartRef, rsiChartRef, macdChartRef],
  )

  /* 데이터 로드 — Backend API 사용 */
  const loadData = useCallback(async () => {
    try {
      setLoading(true)

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

  useEffect(() => { loadData() }, [loadData])

  /* 차트 생성 — 데이터 준비 후 */
  useEffect(() => {
    if (!chartData || loading) return

    const timer = setTimeout(() => {
      if (!mainContainerRef.current) return

      // 기존 인스턴스 제거
      ;[mainChartRef, volChartRef, rsiChartRef, macdChartRef].forEach(ref => {
        try { ref.current?.remove() } catch (_) {}
        ref.current = null
      })

      const width = mainContainerRef.current.clientWidth || 360

      /* 메인 캔들 차트 */
      const mainChart = createChart(mainContainerRef.current, {
        ...BASE_CHART_OPTIONS,
        width,
        height: mainContainerRef.current.clientHeight || 400,
      })
      mainChartRef.current = mainChart

      const candleSeries = mainChart.addCandlestickSeries({
        upColor: '#0ECB81', downColor: '#F6465D',
        borderUpColor: '#0ECB81', borderDownColor: '#F6465D',
        wickUpColor: '#0ECB81', wickDownColor: '#F6465D',
      })
      candleSeries.setData(chartData.candleData)

      if (showMA.ma20) {
        const s = mainChart.addLineSeries({ color: '#FFA500', lineWidth: 1, title: 'MA20' })
        s.setData(chartData.maData.ma20)
      }
      if (showMA.ma50) {
        const s = mainChart.addLineSeries({ color: '#00BFFF', lineWidth: 1, title: 'MA50' })
        s.setData(chartData.maData.ma50)
      }
      if (showMA.ma200) {
        const s = mainChart.addLineSeries({ color: '#FF1493', lineWidth: 2, title: 'MA200' })
        s.setData(chartData.maData.ma200)
      }
      mainChart.timeScale().fitContent()

      /* 볼륨 차트 */
      if (volContainerRef.current) {
        const vc = createChart(volContainerRef.current, {
          ...BASE_CHART_OPTIONS,
          width: volContainerRef.current.clientWidth || width,
          height: volContainerRef.current.clientHeight || 100,
        })
        volChartRef.current = vc
        const vs = vc.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
        vs.setData(chartData.volumeData)
        vc.timeScale().fitContent()
      }

      /* RSI 차트 */
      if (rsiContainerRef.current) {
        const rc = createChart(rsiContainerRef.current, {
          ...BASE_CHART_OPTIONS,
          width: rsiContainerRef.current.clientWidth || width,
          height: rsiContainerRef.current.clientHeight || 100,
        })
        rsiChartRef.current = rc
        const rs = rc.addLineSeries({ color: '#9333EA', lineWidth: 2 })
        rs.setData(chartData.rsiData)
        rs.createPriceLine({ price: 70, color: '#EF4444', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' })
        rs.createPriceLine({ price: 30, color: '#10B981', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' })
        rc.timeScale().fitContent()
      }

      /* MACD 차트 */
      if (macdContainerRef.current) {
        const mc = createChart(macdContainerRef.current, {
          ...BASE_CHART_OPTIONS,
          width: macdContainerRef.current.clientWidth || width,
          height: macdContainerRef.current.clientHeight || 100,
        })
        macdChartRef.current = mc
        const hs = mc.addHistogramSeries({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
        hs.setData(chartData.macdData.histogram)
        const ml = mc.addLineSeries({ color: '#2962FF', lineWidth: 2 })
        ml.setData(chartData.macdData.macdLine)
        const sg = mc.addLineSeries({ color: '#FF6D00', lineWidth: 2 })
        sg.setData(chartData.macdData.signal)
        mc.timeScale().fitContent()
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      ;[mainChartRef, volChartRef, rsiChartRef, macdChartRef].forEach(ref => {
        try { ref.current?.remove() } catch (_) {}
        ref.current = null
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartData, loading, showMA])

  /* ─── 렌더 ───────────────────────────────────────── */

  if (loading) return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="loading-container">데이터 로딩 중...</div>
      </div>
    </div>
  )

  if (error) return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="error-container">오류: {error}</div>
      </div>
    </div>
  )

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">

          {/* 헤더 */}
          <div className="chart-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <h2 className="chart-title">BTC/USDT</h2>
              {currentPrice && (
                <>
                  <span style={{ color: '#EAECEF', fontSize: 'clamp(16px, 4vw, 24px)', fontWeight: 600 }}>
                    ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {priceChange !== null && (
                    <span style={{
                      color: priceChange >= 0 ? '#0ECB81' : '#F6465D',
                      fontSize: '14px',
                      fontWeight: 500,
                    }}>
                      {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  )}
                </>
              )}
            </div>

            {/* MA 토글 */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { key: 'ma20',  label: 'MA20',  color: '#FFA500' },
                { key: 'ma50',  label: 'MA50',  color: '#00BFFF' },
                { key: 'ma200', label: 'MA200', color: '#FF1493' },
              ].map(({ key, label, color }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showMA[key]}
                    onChange={e => setShowMA(prev => ({ ...prev, [key]: e.target.checked }))}
                  />
                  <span style={{ color, fontSize: '12px' }}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 차트 영역 — flex로 남은 공간 채움 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#0B0E11' }}>
            {/* 메인 캔들 차트 — 가장 큰 비중 */}
            <div
              ref={mainContainerRef}
              style={{ flex: '4', minHeight: 200, width: '100%' }}
            />

            <div style={{ padding: '4px 16px', color: '#848E9C', fontSize: '11px', flexShrink: 0 }}>Volume</div>
            <div ref={volContainerRef}  style={{ flex: '1', minHeight: 70, width: '100%' }} />

            <div style={{ padding: '4px 16px', color: '#848E9C', fontSize: '11px', flexShrink: 0 }}>RSI (14)</div>
            <div ref={rsiContainerRef}  style={{ flex: '1', minHeight: 70, width: '100%' }} />

            <div style={{ padding: '4px 16px', color: '#848E9C', fontSize: '11px', flexShrink: 0 }}>MACD (12, 26, 9)</div>
            <div ref={macdContainerRef} style={{ flex: '1', minHeight: 70, width: '100%' }} />
          </div>

          {/* 푸터 */}
          <div className="chart-footer">
            🖱️ Drag: Pan &nbsp;|&nbsp; 🔍 Wheel: Zoom &nbsp;|&nbsp; 📱 Pinch: Touch Zoom
          </div>
        </div>
      </div>
    </div>
  )
}
