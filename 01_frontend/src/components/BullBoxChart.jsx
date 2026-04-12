import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useBullBoxData } from '../hooks/useChartData'
import { useResizeChart } from '../hooks/useResizeChart'
import { CHART_THEME } from '../utils/chartConstants'
import { ChartErrorState, ChartLoadingState } from './ChartStatus'
import '../styles/Chart.css'

function toDateString(timestamp) {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function BullBoxChart({ cycleNumber = 3 }) {
  const { lineData, boxes, loading, error, cycleInfo } = useBullBoxData(cycleNumber)
  const containerRef = useRef(null)
  const chartRef = useRef(null)

  const resizeLayoutKey = !loading && !error && lineData.length > 0 ? lineData.length : 0

  useResizeChart(containerRef, [chartRef], {
    watchHeight: true,
    layoutKey: resizeLayoutKey,
  })

  useEffect(() => {
    if (!containerRef.current || lineData.length === 0) return

    const dateToDay = {}
    lineData.forEach((item) => {
      if (item.timestamp) dateToDay[toDateString(item.timestamp)] = item.day
    })

    try {
      chartRef.current?.remove()
    } catch (_) {}
    chartRef.current = null

    const chart = createChart(containerRef.current, {
      layout: { background: { color: CHART_THEME.background }, textColor: CHART_THEME.textMuted },
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
      timeScale: { borderColor: CHART_THEME.border, timeVisible: false },
      localization: {
        timeFormatter: (timestamp) => {
          if (typeof timestamp === 'string') {
            const day = dateToDay[timestamp]
            return day !== undefined ? `Day ${day}` : timestamp
          }
          const dateStr = toDateString(new Date(timestamp * 1000).toISOString())
          const day = dateToDay[dateStr]
          return day !== undefined ? `Day ${day}` : dateStr
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width: containerRef.current.clientWidth || 360,
      height: containerRef.current.clientHeight || 500,
    })
    chartRef.current = chart

    const lineSeries = chart.addLineSeries({ color: CHART_THEME.success, lineWidth: 2 })
    const chartData = lineData
      .filter((item) => item.timestamp)
      .map((item) => ({ time: toDateString(item.timestamp), value: item.value }))
      .filter((item) => item.time)
    lineSeries.setData(chartData)

    boxes.forEach((box, idx) => {
      const startDate = toDateString(box.Start_Timestamp)
      const endDate = toDateString(box.End_Timestamp)
      const lowDate = toDateString(box.Low_Timestamp)
      if (!startDate || !endDate) return

      const prevBox = idx > 0 ? boxes[idx - 1] : null
      const prevLowRate = prevBox ? prevBox.Low_Rate : box.Low_Rate
      const riseFromPrevLow = ((box.Start_Rate - prevLowRate) / prevLowRate * 100).toFixed(1)
      const dropFromPrevHigh = ((box.Start_Rate - box.Low_Rate) / box.Start_Rate * 100).toFixed(1)

      const topLine = chart.addLineSeries({
        color: CHART_THEME.danger,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      topLine.setData([
        { time: startDate, value: box.Start_Rate },
        { time: endDate, value: box.Start_Rate },
      ])
      topLine.setMarkers([{
        time: startDate,
        position: 'aboveBar',
        color: CHART_THEME.danger,
        shape: 'arrowDown',
        text: `H${idx + 1} ${box.Start_Rate.toFixed(1)}% (+${riseFromPrevLow}%)`,
      }])

      const bottomLineData = [
        { time: startDate, value: box.Low_Rate },
        { time: endDate, value: box.Low_Rate },
      ]
      if (lowDate && lowDate !== startDate && lowDate !== endDate) {
        bottomLineData.push({ time: lowDate, value: box.Low_Rate })
      }
      bottomLineData.sort((a, b) => a.time.localeCompare(b.time))

      const bottomLine = chart.addLineSeries({
        color: CHART_THEME.success,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      bottomLine.setData(bottomLineData)
      if (lowDate) {
        bottomLine.setMarkers([{
          time: lowDate,
          position: 'belowBar',
          color: CHART_THEME.success,
          shape: 'circle',
          text: `L${idx + 1} ${box.Low_Rate.toFixed(1)}% (-${dropFromPrevHigh}%)`,
        }])
      }
    })

    chart.timeScale().fitContent()

    return () => {
      try {
        chartRef.current?.remove()
      } catch (_) {}
      chartRef.current = null
    }
  }, [lineData, boxes])

  if (loading) {
    return (
      <div className="chart-page"><div className="chart-container">
        <ChartLoadingState
          title="데이터를 불러오는 중입니다..."
          message="Bull Market Box 구간을 준비하고 있습니다."
        />
      </div></div>
    )
  }

  if (error) {
    return (
      <div className="chart-page"><div className="chart-container">
        <ChartErrorState
          title="Bull Market Box 데이터를 불러오지 못했습니다."
          message={error}
        />
      </div></div>
    )
  }

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">
          <div className="chart-title-strip">
            <span className="chart-title-strip-kicker">Bull Box</span>
            <h2 className="chart-title-strip-heading">Cycle {cycleNumber} Bull Market Box</h2>
            <p className="chart-title-strip-copy">
              상승 사이클의 박스 전개와 전체 기간 흐름을 빠르게 읽을 수 있게 압축했습니다.
            </p>
          </div>

          <div ref={containerRef} className="chart-area chart-area-fill" />

          <div className="chart-footer chart-footer-row single-line">
            <span>
              <strong className="chart-strong-success">박스:</strong> {boxes.length}개
              &nbsp;|&nbsp;
              <strong className="chart-strong-info">총 기간:</strong> {cycleInfo.maxDays}일
            </span>
            <span>Data: Supabase cycle data</span>
          </div>
        </div>
      </div>
    </div>
  )
}
