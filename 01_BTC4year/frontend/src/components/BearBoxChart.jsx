import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useBearBoxData } from '../hooks/useChartData'
import { useResizeChart } from '../hooks/useResizeChart'
import '../styles/Chart.css'

function toDateString(timestamp) {
  if (!timestamp) return null
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BearBoxChart({ cycleNumber = 4 }) {
  const { lineData, boxes, loading, error, cycleInfo, config } = useBearBoxData(cycleNumber)
  const containerRef = useRef(null)
  const chartRef     = useRef(null)

  /* ResizeObserver 반응형 */
  useResizeChart(containerRef, [chartRef], { watchHeight: true })

  useEffect(() => {
    if (!containerRef.current || lineData.length === 0) return

    const dateToDay = {}
    lineData.forEach(d => {
      if (d.timestamp) dateToDay[toDateString(d.timestamp)] = d.day
    })

    try { chartRef.current?.remove() } catch (_) {}
    chartRef.current = null

    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0B0E11' }, textColor: '#848E9C' },
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
      timeScale: { borderColor: '#2B3139', timeVisible: false },
      localization: {
        timeFormatter: (ts) => {
          if (typeof ts === 'string') {
            const day = dateToDay[ts]
            return day !== undefined ? `Day ${day}` : ts
          }
          const dateStr = toDateString(new Date(ts * 1000).toISOString())
          const day = dateToDay[dateStr]
          return day !== undefined ? `Day ${day}` : dateStr
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width:  containerRef.current.clientWidth  || 360,
      height: containerRef.current.clientHeight || 500,
    })
    chartRef.current = chart

    const lineSeries = chart.addLineSeries({ color: '#3B82F6', lineWidth: 2 })
    const chartData = lineData
      .filter(d => d.timestamp)
      .map(d => ({ time: toDateString(d.timestamp), value: d.value }))
      .filter(d => d.time)
    lineSeries.setData(chartData)

    boxes.forEach((box, idx) => {
      const startDate = toDateString(box.Start_Timestamp)
      const endDate   = toDateString(box.End_Timestamp)
      const peakDate  = toDateString(box.Peak_Timestamp)
      if (!startDate || !endDate) return

      const prevBox         = idx > 0 ? boxes[idx - 1] : null
      const prevPeakRate    = prevBox ? prevBox.Peak_Rate : 100
      const dropFromPrevHigh = ((prevPeakRate - box.Start_Rate) / prevPeakRate * 100).toFixed(1)
      const riseFromPrevLow  = ((box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100).toFixed(1)

      // 빨간 점선 (고점 수평선) — peakDate 포인트 포함해서 해당 시점 value 확보
      const topLineData = [
        { time: startDate, value: box.Peak_Rate },
        { time: endDate,   value: box.Peak_Rate },
      ]
      if (peakDate && peakDate !== startDate && peakDate !== endDate) {
        topLineData.push({ time: peakDate, value: box.Peak_Rate })
      }
      topLineData.sort((a, b) => a.time.localeCompare(b.time))

      const topLine = chart.addLineSeries({
        color: '#F6465D', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      topLine.setData(topLineData)

      // 고점 마커를 topLine에 직접 부착 → Peak_Rate 값 기준 aboveBar
      if (peakDate) {
        topLine.setMarkers([{
          time: peakDate, position: 'aboveBar', color: '#F6465D', shape: 'arrowDown',
          text: `H${idx + 1} ${box.Peak_Rate.toFixed(1)}% ↑${riseFromPrevLow}%`,
        }])
      }

      // 초록 점선 (저점 수평선)
      const bottomLine = chart.addLineSeries({
        color: '#0ECB81', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      bottomLine.setData([
        { time: startDate, value: box.Start_Rate },
        { time: endDate,   value: box.Start_Rate },
      ])

      // 저점 마커를 bottomLine에 직접 부착 → Start_Rate 값 기준 belowBar
      bottomLine.setMarkers([{
        time: startDate, position: 'belowBar', color: '#0ECB81', shape: 'circle',
        text: `L${idx + 1} ${box.Start_Rate.toFixed(1)}% ↓${dropFromPrevHigh}%`,
      }])
    })

    chart.timeScale().fitContent()

    return () => {
      try { chartRef.current?.remove() } catch (_) {}
      chartRef.current = null
    }
  }, [lineData, boxes])

  if (loading) return (
    <div className="chart-page"><div className="chart-container">
      <div className="loading-container">데이터 로딩 중...</div>
    </div></div>
  )

  if (error) return (
    <div className="chart-page"><div className="chart-container">
      <div className="error-container">오류: {error}</div>
    </div></div>
  )

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <h2 className="chart-title">
                🐻 Cycle {cycleNumber} ({cycleInfo.startDate}) — Bear Market Box
              </h2>
              <p style={{ color: '#848E9C', margin: '4px 0 0', fontSize: '12px' }}>
                Rise ≥{config.RISE_THRESHOLD}% | Break &lt;{config.BREAK_THRESHOLD}% | 0~420 Days
              </p>
            </div>
          </div>

          {/* 차트 — flex 나머지 공간 전부 사용 */}
          <div
            ref={containerRef}
            className="chart-area"
            style={{ flex: 1, minHeight: 0, width: '100%' }}
          />

          <div className="chart-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>
              <strong style={{ color: '#0ECB81' }}>박스: </strong>{boxes.length}개
              &nbsp;|&nbsp;
              <strong style={{ color: '#F6465D' }}>기간: </strong>0~420일
            </span>
            <span>Data: Supabase bitcoin_cycle_data</span>
          </div>
        </div>
      </div>
    </div>
  )
}
