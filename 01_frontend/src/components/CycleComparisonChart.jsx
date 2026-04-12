import { useState, useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useCycleComparisonData } from '../hooks/useChartData'
import { CHART_THEME, COLORS, COLOR_NAMES } from '../utils/chartConstants'
import { useResizeChart } from '../hooks/useResizeChart'
import { ChartErrorState, ChartLoadingState } from './ChartStatus'
import '../styles/Chart.css'

function dayToDateString(day) {
  const base = new Date(2000, 0, 1)
  const target = new Date(base.getTime() + day * 86400000)
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`
}

export default function CycleComparisonChart({ onHeaderContent }) {
  const { series, loading, error } = useCycleComparisonData()
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const [hiddenSeries, setHiddenSeries] = useState(new Set())

  const resizeLayoutKey = !loading && !error && series.length > 0 ? series.length : 0

  useResizeChart(containerRef, [chartRef], {
    watchHeight: true,
    layoutKey: resizeLayoutKey,
  })

  const toggleSeries = (name) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  useEffect(() => {
    if (!onHeaderContent || series.length === 0) return

    onHeaderContent(
      <>
        <span className="header-slot-title">Bitcoin Cycles Comparison</span>
        <span className="header-slot-sub">Days since peak</span>
        {series.map((item, idx) => (
          <div
            key={item.name}
            className={`header-stat-card ${hiddenSeries.has(item.name) ? 'inactive' : ''}`}
            onClick={() => toggleSeries(item.name)}
          >
            <span className={`header-stat-label tone-${COLOR_NAMES[idx % COLOR_NAMES.length]}`}>
              C{idx + 1}: {item.startDate}
            </span>
            <span className="header-stat-value">
              <span>{item.minRate.toFixed(1)}%</span>
              <span>{item.dayCount}d</span>
            </span>
          </div>
        ))}
      </>
    )
  }, [series, hiddenSeries, onHeaderContent])

  useEffect(() => {
    return () => {
      if (onHeaderContent) onHeaderContent(null)
    }
  }, [onHeaderContent])

  useEffect(() => {
    if (!containerRef.current || series.length === 0) return

    try {
      chartRef.current?.remove()
    } catch (_) {}
    chartRef.current = null

    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: CHART_THEME.textMuted },
      grid: {
        vertLines: { color: CHART_THEME.grid, style: 1 },
        horzLines: { color: CHART_THEME.grid, style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: CHART_THEME.accent, width: 1, style: 3, labelBackgroundColor: CHART_THEME.crosshairLabel },
        horzLine: { color: CHART_THEME.accent, width: 1, style: 3, labelBackgroundColor: CHART_THEME.crosshairLabel },
      },
      rightPriceScale: { borderColor: CHART_THEME.border, textColor: CHART_THEME.textMuted },
      timeScale: {
        borderColor: CHART_THEME.border,
        textColor: CHART_THEME.textMuted,
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
      width: containerRef.current.clientWidth || 360,
      height: containerRef.current.clientHeight || 400,
    })
    chartRef.current = chart

    ;[100, 50, 25].forEach((value, index) => {
      const baselineSeries = chart.addLineSeries({
        color: index === 0 ? CHART_THEME.textSoft : 'rgba(148, 163, 184, 0.28)',
        lineWidth: index === 0 ? 2 : 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      baselineSeries.setData([
        { time: dayToDateString(0), value },
        { time: dayToDateString(1500), value },
      ])
    })

    series.forEach((item, idx) => {
      if (hiddenSeries.has(item.name)) return
      const color = COLORS[idx % COLORS.length]
      const lineSeries = chart.addLineSeries({
        color,
        lineWidth: 2.5,
        title: item.name,
      })
      lineSeries.setData(item.data.map((point) => ({ time: dayToDateString(point.x), value: point.y })))
      lineSeries.createPriceLine({
        price: item.minRate,
        color,
        lineWidth: 1.5,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `C${idx + 1} Min (${item.minRate.toFixed(1)}%)`,
      })
    })

    chart.timeScale().setVisibleRange({
      from: dayToDateString(0),
      to: dayToDateString(900),
    })

    return () => {
      try {
        chartRef.current?.remove()
      } catch (_) {}
      chartRef.current = null
    }
  }, [series, hiddenSeries])

  if (loading) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <div className="chart-wrapper">
            <ChartLoadingState
              title="데이터를 불러오는 중입니다..."
              message="사이클 비교 구간과 하락률 데이터를 준비하고 있습니다."
            />
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <div className="chart-wrapper">
            <ChartErrorState
              title="사이클 비교 데이터를 불러오지 못했습니다."
              message={error}
            />
          </div>
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
              <span className="chart-eyebrow">Cycle Comparison</span>
              <h2 className="chart-title">비트코인 사이클 하락률 비교</h2>
              <p className="chart-description">
                각 사이클의 고점 이후 낙폭과 회복 흐름을 같은 축에서 겹쳐 유사 구간을 빠르게 읽습니다.
              </p>
            </div>
          </div>

          <div ref={containerRef} className="chart-area chart-area-compact" />

          <div className="chart-footer chart-footer-row">
            <span>Data source: Supabase BTC/USDT OHLCV</span>
          </div>
        </div>
      </div>
    </div>
  )
}

