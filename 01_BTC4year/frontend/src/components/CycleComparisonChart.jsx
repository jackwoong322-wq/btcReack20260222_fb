import { useState, useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useCycleComparisonData } from '../hooks/useChartData'
import { COLORS } from '../utils/chartData'
import '../styles/Chart.css'

// Day를 가상 날짜로 변환 (2000-01-01 기준)
// lightweight-charts가 날짜를 제대로 처리하도록
function dayToDateString(day) {
  const baseDate = new Date(2000, 0, 1) // 2000-01-01
  const targetDate = new Date(baseDate.getTime() + day * 24 * 60 * 60 * 1000)
  const year = targetDate.getFullYear()
  const month = String(targetDate.getMonth() + 1).padStart(2, '0')
  const d = String(targetDate.getDate()).padStart(2, '0')
  return `${year}-${month}-${d}`
}

export default function CycleComparisonChart() {
  const { series, loading, error, maxDays } = useCycleComparisonData()
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRefs = useRef({})
  
  const [hiddenSeries, setHiddenSeries] = useState(new Set())

  useEffect(() => {
    if (!chartContainerRef.current || series.length === 0) return

    if (chartRef.current) {
      try {
        chartRef.current.remove()
      } catch (e) {}
      chartRef.current = null
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#94A3B8',
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.08)', style: 1 },
        horzLines: { color: 'rgba(255, 255, 255, 0.08)', style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#F59E0B',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1E293B',
        },
        horzLine: {
          color: '#F59E0B',
          width: 1,
          style: 3,
          labelBackgroundColor: '#1E293B',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        textColor: '#94A3B8',
      },
      timeScale: {
        borderColor: '#2B3139',
        textColor: '#848E9C',
        visible: true,
        timeVisible: false,
        // X축을 "Day N" 형식으로 표시
        tickMarkFormatter: (time) => {
          // time은 yyyy-mm-dd 형식의 날짜 → Day로 역변환
          const baseDate = new Date(2000, 0, 1)
          const currentDate = new Date(time)
          const diffDays = Math.round((currentDate - baseDate) / (24 * 60 * 60 * 1000))
          return `${diffDays}d`
        },
      },
      localization: {
        timeFormatter: (time) => {
          const baseDate = new Date(2000, 0, 1)
          const currentDate = new Date(time)
          const diffDays = Math.round((currentDate - baseDate) / (24 * 60 * 60 * 1000))
          return `Day ${diffDays}`
        },
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
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })

    chartRef.current = chart

    // Peak 라인 (100%)
    const peakLine = chart.addLineSeries({
      color: '#64748B',
      lineWidth: 2,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    peakLine.setData([
      { time: dayToDateString(0), value: 100 },
      { time: dayToDateString(1500), value: 100 },
    ])

    // 50% 참조선
    const refLine50 = chart.addLineSeries({
      color: 'rgba(148, 163, 184, 0.3)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    refLine50.setData([
      { time: dayToDateString(0), value: 50 },
      { time: dayToDateString(1500), value: 50 },
    ])

    // 25% 참조선
    const refLine25 = chart.addLineSeries({
      color: 'rgba(148, 163, 184, 0.3)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    refLine25.setData([
      { time: dayToDateString(0), value: 25 },
      { time: dayToDateString(1500), value: 25 },
    ])

    // 각 사이클 시리즈 추가
    series.forEach((s, idx) => {
      if (!hiddenSeries.has(s.name)) {
        const lineSeries = chart.addLineSeries({
          color: COLORS[idx % COLORS.length],
          lineWidth: 2.5,
          title: s.name,
        })

        // Day를 가상 날짜로 변환
        const lineData = s.data.map(point => ({
          time: dayToDateString(point.x),
          value: point.y,
        }))

        lineSeries.setData(lineData)
        
        lineSeries.createPriceLine({
          price: s.minRate,
          color: COLORS[idx % COLORS.length],
          lineWidth: 1.5,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `C${idx + 1} Min (${s.minRate.toFixed(1)}%)`,
        })

        seriesRefs.current[s.name] = lineSeries
      }
    })

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }

    window.addEventListener('resize', handleResize)

    // 초기 뷰를 0-900일로 설정
    chart.timeScale().setVisibleRange({
      from: dayToDateString(0),
      to: dayToDateString(900),
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        try {
          chartRef.current.remove()
        } catch (e) {}
        chartRef.current = null
      }
    }
  }, [series, hiddenSeries])

  const toggleSeries = (seriesName) => {
    setHiddenSeries(prev => {
      const next = new Set(prev)
      if (next.has(seriesName)) {
        next.delete(seriesName)
      } else {
        next.add(seriesName)
      }
      return next
    })
  }

  const resetView = () => {
    if (chartRef.current) {
      chartRef.current.timeScale().setVisibleRange({
        from: dayToDateString(0),
        to: dayToDateString(900),
      })
    }
  }

  if (loading) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <div className="chart-wrapper">
            <div className="loading-container">데이터 로딩 중...</div>
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
            <div className="error-container">오류: {error}</div>
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
            <div>
              <h2 className="chart-title">Bitcoin Cycles Comparison</h2>
              <p style={{ color: '#848E9C', fontSize: '12px', margin: '4px 0 0 0' }}>
                X축: Days Since Peak
              </p>
            </div>
            
            <div className="stats">
              {series.map((s, idx) => (
                <div
                  key={s.name}
                  className={`stat-card ${s.colorName} ${hiddenSeries.has(s.name) ? 'inactive' : ''}`}
                  onClick={() => toggleSeries(s.name)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={`stat-label ${s.colorName}`}>
                    C{idx + 1}:{s.startDate}
                  </span>
                  <span className="stat-value">
                    <span>{s.minRate.toFixed(1)}%</span>
                    <span>{s.dayCount}d</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="toolbar">
              <button className="toolbar-btn" title="초기화" onClick={resetView}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </div>
          </div>

          <div 
            ref={chartContainerRef}
            className="chart-area"
            style={{ width: '100%', height: '100%', position: 'relative' }}
          />

          <div className="chart-footer">
            Data source: Supabase BTC/USDT OHLCV
          </div>
        </div>
      </div>
    </div>
  )
}
