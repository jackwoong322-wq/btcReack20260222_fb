import { useState, useEffect, useRef, useCallback } from 'react'
import { createChart } from 'lightweight-charts'
import { fetchOhlcvData } from '../lib/api'
import { useResizeChart } from '../hooks/useResizeChart'
import { CHART_THEME } from '../utils/chartConstants'
import { ChartErrorState, ChartLoadingState } from './ChartStatus'
import '../styles/Chart.css'

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
    const gains = slice.filter((change) => change > 0)
    const losses = slice.filter((change) => change < 0).map(Math.abs)
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
  const timeSet = new Set(signal.map((item) => item.time))
  const histogram = macdLine
    .filter((item) => timeSet.has(item.time))
    .map((item) => {
      const sig = signal.find((signalItem) => signalItem.time === item.time)
      return {
        time: item.time,
        value: item.value - sig.value,
        color: item.value >= sig.value ? CHART_THEME.success : CHART_THEME.danger,
      }
    })
  return { macdLine, signal, histogram }
}

const BASE_CHART_OPTIONS = {
  layout: {
    background: { color: CHART_THEME.background },
    textColor: CHART_THEME.textMuted,
  },
  localization: { dateFormat: 'yyyy-MM-dd' },
  grid: {
    vertLines: { color: CHART_THEME.grid },
    horzLines: { color: CHART_THEME.grid },
  },
  crosshair: {
    mode: 1,
    vertLine: { color: CHART_THEME.crosshair, width: 1, style: 3, labelBackgroundColor: CHART_THEME.crosshairLabel },
    horzLine: { color: CHART_THEME.crosshair, width: 1, style: 3, labelBackgroundColor: CHART_THEME.crosshairLabel },
  },
  rightPriceScale: { borderColor: CHART_THEME.border },
  timeScale: {
    borderColor: CHART_THEME.border,
    textColor: CHART_THEME.textMuted,
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

const MA_TOGGLES = [
  { key: 'ma20', label: 'MA20', tone: 'gold' },
  { key: 'ma50', label: 'MA50', tone: 'steel' },
  { key: 'ma200', label: 'MA200', tone: 'violet' },
]

export default function TradingChart() {
  const mainContainerRef = useRef(null)
  const volContainerRef = useRef(null)
  const rsiContainerRef = useRef(null)
  const macdContainerRef = useRef(null)

  const mainChartRef = useRef(null)
  const volChartRef = useRef(null)
  const rsiChartRef = useRef(null)
  const macdChartRef = useRef(null)

  const [showMA, setShowMA] = useState({ ma20: true, ma50: true, ma200: true })
  const [currentPrice, setCurrentPrice] = useState(null)
  const [priceChange, setPriceChange] = useState(null)
  const [chartData, setChartData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const resizeLayoutKey = !loading && !error && chartData?.candleData?.length
    ? chartData.candleData.length
    : 0

  useResizeChart(mainContainerRef, [mainChartRef, volChartRef, rsiChartRef, macdChartRef], {
    layoutKey: resizeLayoutKey,
  })

  const loadData = useCallback(async () => {
    try {
      setLoading(true)

      const result = await fetchOhlcvData()
      const allData = result.data || []

      if (allData.length === 0) throw new Error('데이터가 없습니다.')

      const candleData = allData.map((item) => ({
        time: item.readable_time.split('T')[0],
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
      }))

      const volumeData = allData.map((item) => ({
        time: item.readable_time.split('T')[0],
        value: item.volume,
        color: item.close >= item.open ? 'rgba(115, 184, 141, 0.5)' : 'rgba(209, 125, 104, 0.5)',
      }))

      setChartData({
        candleData,
        volumeData,
        maData: {
          ma20: calculateMA(candleData, 20),
          ma50: calculateMA(candleData, 50),
          ma200: calculateMA(candleData, 200),
        },
        rsiData: calculateRSI(candleData),
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

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (!chartData || loading) return

    const timer = setTimeout(() => {
      if (!mainContainerRef.current) return

      ;[mainChartRef, volChartRef, rsiChartRef, macdChartRef].forEach((ref) => {
        try {
          ref.current?.remove()
        } catch (_) {}
        ref.current = null
      })

      const width = mainContainerRef.current.clientWidth || 360

      const mainChart = createChart(mainContainerRef.current, {
        ...BASE_CHART_OPTIONS,
        width,
        height: mainContainerRef.current.clientHeight || 400,
      })
      mainChartRef.current = mainChart

      const candleSeries = mainChart.addCandlestickSeries({
        upColor: CHART_THEME.success,
        downColor: CHART_THEME.danger,
        borderUpColor: CHART_THEME.success,
        borderDownColor: CHART_THEME.danger,
        wickUpColor: CHART_THEME.success,
        wickDownColor: CHART_THEME.danger,
      })
      candleSeries.setData(chartData.candleData)

      if (showMA.ma20) {
        const series = mainChart.addLineSeries({ color: CHART_THEME.accent, lineWidth: 1, title: 'MA20' })
        series.setData(chartData.maData.ma20)
      }
      if (showMA.ma50) {
        const series = mainChart.addLineSeries({ color: CHART_THEME.info, lineWidth: 1, title: 'MA50' })
        series.setData(chartData.maData.ma50)
      }
      if (showMA.ma200) {
        const series = mainChart.addLineSeries({ color: '#b691ff', lineWidth: 2, title: 'MA200' })
        series.setData(chartData.maData.ma200)
      }
      mainChart.timeScale().fitContent()

      if (volContainerRef.current) {
        const volumeChart = createChart(volContainerRef.current, {
          ...BASE_CHART_OPTIONS,
          width: volContainerRef.current.clientWidth || width,
          height: volContainerRef.current.clientHeight || 100,
        })
        volChartRef.current = volumeChart
        const volumeSeries = volumeChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' })
        volumeSeries.setData(chartData.volumeData)
        volumeChart.timeScale().fitContent()
      }

      if (rsiContainerRef.current) {
        const rsiChart = createChart(rsiContainerRef.current, {
          ...BASE_CHART_OPTIONS,
          width: rsiContainerRef.current.clientWidth || width,
          height: rsiContainerRef.current.clientHeight || 100,
        })
        rsiChartRef.current = rsiChart
        const rsiSeries = rsiChart.addLineSeries({ color: '#a78bfa', lineWidth: 2 })
        rsiSeries.setData(chartData.rsiData)
        rsiSeries.createPriceLine({ price: 70, color: CHART_THEME.danger, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' })
        rsiSeries.createPriceLine({ price: 30, color: CHART_THEME.success, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' })
        rsiChart.timeScale().fitContent()
      }

      if (macdContainerRef.current) {
        const macdChart = createChart(macdContainerRef.current, {
          ...BASE_CHART_OPTIONS,
          width: macdContainerRef.current.clientWidth || width,
          height: macdContainerRef.current.clientHeight || 100,
        })
        macdChartRef.current = macdChart
        const histogramSeries = macdChart.addHistogramSeries({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } })
        histogramSeries.setData(chartData.macdData.histogram)
        const macdLineSeries = macdChart.addLineSeries({ color: CHART_THEME.info, lineWidth: 2 })
        macdLineSeries.setData(chartData.macdData.macdLine)
        const signalSeries = macdChart.addLineSeries({ color: CHART_THEME.accent, lineWidth: 2 })
        signalSeries.setData(chartData.macdData.signal)
        macdChart.timeScale().fitContent()
      }
    }, 50)

    return () => {
      clearTimeout(timer)
      ;[mainChartRef, volChartRef, rsiChartRef, macdChartRef].forEach((ref) => {
        try {
          ref.current?.remove()
        } catch (_) {}
        ref.current = null
      })
    }
  }, [chartData, loading, showMA])

  if (loading) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <ChartLoadingState
            title="데이터를 불러오는 중입니다..."
            message="일간 OHLCV와 보조 지표를 준비하고 있습니다."
          />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <ChartErrorState
            title="차트 데이터를 불러오지 못했습니다."
            message={error}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">
          <div className="chart-header">
            <div className="chart-meta">
              <span className="chart-eyebrow">Market Structure</span>
              <h2 className="chart-title">BTC/USDT Daily Trading View</h2>
              <p className="chart-description">
                장기 이동평균과 RSI, MACD를 한 화면에 겹쳐 현재 흐름과 추세 강도를 함께 읽습니다.
              </p>
              {currentPrice && (
                <div className="chart-summary">
                  <span className="chart-price">
                    ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {priceChange !== null && (
                    <span className={`chart-delta ${priceChange >= 0 ? 'positive' : 'negative'}`}>
                      {priceChange >= 0 ? '+' : ''}
                      {priceChange.toFixed(2)}%
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="indicator-toggle-group">
              {MA_TOGGLES.map(({ key, label, tone }) => (
                <label key={key} className="indicator-toggle">
                  <input
                    type="checkbox"
                    checked={showMA[key]}
                    aria-label={`${label} 표시 전환`}
                    onChange={(event) => setShowMA((prev) => ({ ...prev, [key]: event.target.checked }))}
                  />
                  <span className={`indicator-toggle-label tone-${tone}`}>
                    {label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="chart-stack">
            <div ref={mainContainerRef} className="chart-stack-main" />

            <div className="chart-stack-section-label">Volume</div>
            <div ref={volContainerRef} className="chart-stack-sub" />

            <div className="chart-stack-section-label">RSI (14)</div>
            <div ref={rsiContainerRef} className="chart-stack-sub" />

            <div className="chart-stack-section-label">MACD (12, 26, 9)</div>
            <div ref={macdContainerRef} className="chart-stack-sub" />
          </div>

          <div className="chart-footer">
            Drag: pan | Wheel: zoom | Pinch: touch zoom
          </div>
        </div>
      </div>
    </div>
  )
}

