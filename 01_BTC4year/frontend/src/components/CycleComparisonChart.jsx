import { useState, useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useCycleComparisonData } from '../hooks/useChartData'
import { COLORS, COLOR_NAMES } from '../utils/chartData'
import { useResizeChart } from '../hooks/useResizeChart'
import '../styles/Chart.css'

function dayToDateString(day) {
  const base = new Date(2000, 0, 1)
  const target = new Date(base.getTime() + day * 86400000)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
}

export default function CycleComparisonChart({ onHeaderContent }) {
  const { series, loading, error } = useCycleComparisonData()
  const containerRef = useRef(null)
  const chartRef     = useRef(null)
  const seriesRefs   = useRef({})
  const [hiddenSeries, setHiddenSeries] = useState(new Set())

  /* ResizeObserver 반응형 — width & height 모두 감시 */
  useResizeChart(containerRef, [chartRef], { watchHeight: true })

  // 헤더 슬롯에 타이틀 + 사이클 카드 올리기
  useEffect(() => {
    if (!onHeaderContent) return
    if (series.length === 0) return

    // 그래프 색과 동일한 색상 배열 (COLORS와 동일 순서)
    const colorHex = COLORS  // ['#3B82F6', '#10B981', '#EF4444', '#F59E0B', ...]

    onHeaderContent(
      <>
        <span className="header-slot-title">Bitcoin Cycles Comparison</span>
        <span className="header-slot-sub">| Days Since Peak</span>
        {series.map((s, idx) => (
          <div
            key={s.name}
            className={`header-stat-card ${hiddenSeries.has(s.name) ? 'inactive' : ''}`}
            onClick={() => toggleSeries(s.name)}
          >
            <span
              className="header-stat-label"
              style={{ color: colorHex[idx % colorHex.length] }}
            >
              C{idx + 1}:{s.startDate}
            </span>
            <span className="header-stat-value">
              <span>{s.minRate.toFixed(1)}%</span>
              <span>{s.dayCount}d</span>
            </span>
          </div>
        ))}
      </>
    )
  }, [series, hiddenSeries, onHeaderContent])

  // 언마운트 시 헤더 슬롯 비우기
  useEffect(() => {
    return () => { if (onHeaderContent) onHeaderContent(null) }
  }, [onHeaderContent])

  useEffect(() => {
    if (!containerRef.current || series.length === 0) return

    try { chartRef.current?.remove() } catch (_) {}
    chartRef.current = null
    seriesRefs.current = {}

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#94A3B8' },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.08)', style: 1 },
        horzLines: { color: 'rgba(255,255,255,0.08)', style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#F59E0B', width: 1, style: 3, labelBackgroundColor: '#1E293B' },
        horzLine: { color: '#F59E0B', width: 1, style: 3, labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)', textColor: '#94A3B8' },
      timeScale: {
        borderColor: '#2B3139',
        textColor: '#848E9C',
        timeVisible: false,
        tickMarkFormatter: (time) => {
          const diff = Math.round((new Date(time) - new Date(2000, 0, 1)) / 86400000)
          return `${diff}d`
        },
      },
      localization: {
        timeFormatter: (time) => {
          const diff = Math.round((new Date(time) - new Date(2000, 0, 1)) / 86400000)
          return `Day ${diff}`
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width:  containerRef.current.clientWidth  || 360,
      height: containerRef.current.clientHeight || 400,
    })
    chartRef.current = chart

    /* 기준선 */
    ;[100, 50, 25].forEach((val, i) => {
      const s = chart.addLineSeries({
        color: i === 0 ? '#64748B' : 'rgba(148,163,184,0.3)',
        lineWidth: i === 0 ? 2 : 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      s.setData([
        { time: dayToDateString(0),    value: val },
        { time: dayToDateString(1500), value: val },
      ])
    })

    /* 사이클 시리즈 */
    series.forEach((s, idx) => {
      if (hiddenSeries.has(s.name)) return
      const ls = chart.addLineSeries({
        color: COLORS[idx % COLORS.length],
        lineWidth: 2.5,
        title: s.name,
      })
      ls.setData(s.data.map(pt => ({ time: dayToDateString(pt.x), value: pt.y })))
      ls.createPriceLine({
        price: s.minRate,
        color: COLORS[idx % COLORS.length],
        lineWidth: 1.5,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `C${idx + 1} Min (${s.minRate.toFixed(1)}%)`,
      })
      seriesRefs.current[s.name] = ls
    })

    chart.timeScale().setVisibleRange({
      from: dayToDateString(0),
      to:   dayToDateString(900),
    })

    return () => {
      try { chartRef.current?.remove() } catch (_) {}
      chartRef.current = null
    }
  }, [series, hiddenSeries])

  const toggleSeries = (name) => {
    setHiddenSeries(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const resetView = () => {
    chartRef.current?.timeScale().setVisibleRange({
      from: dayToDateString(0),
      to:   dayToDateString(900),
    })
  }

  if (loading) return (
    <div className="chart-page"><div className="chart-container"><div className="chart-wrapper">
      <div className="loading-container">데이터 로딩 중...</div>
    </div></div></div>
  )

  if (error) return (
    <div className="chart-page"><div className="chart-container"><div className="chart-wrapper">
      <div className="error-container">오류: {error}</div>
    </div></div></div>
  )

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">

          {/* 차트 — 헤더 제거로 전체 공간 사용 */}
          <div
            ref={containerRef}
            className="chart-area"
            style={{ flex: 1, minHeight: 250 }}
          />

          <div className="chart-footer" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
            <span>Data source: Supabase BTC/USDT OHLCV</span>
          </div>
        </div>
      </div>
    </div>
  )
}
