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
  const { lineData, boxes, predictions, loading, error, cycleInfo, config } = useBearBoxData(cycleNumber)
  const containerRef = useRef(null)
  const chartRef     = useRef(null)

  const resizeLayoutKey =
    !loading && !error && lineData.length > 0 ? lineData.length : 0

  /* ResizeObserver 반응형 */
  useResizeChart(containerRef, [chartRef], {
    watchHeight: true,
    layoutKey: resizeLayoutKey,
  })

  useEffect(() => {
    if (!containerRef.current || lineData.length === 0) return

    const dateToDay = {}
    lineData.forEach(d => {
      if (d.timestamp) dateToDay[toDateString(d.timestamp)] = d.day
    })

    // 예측 구간 날짜→Day 매핑: 실제 마지막 Day 기준으로 예측 날짜를 Day로 변환
    if (predictions.length > 0 && lineData.length > 0) {
      const lastReal = lineData[lineData.length - 1]
      const lastRealDate = new Date(lastReal.timestamp)
      const lastRealDay  = lastReal.day

      predictions.forEach(pred => {
        ;[pred.Start_Timestamp, pred.Peak_Timestamp, pred.End_Timestamp].forEach(ts => {
          if (!ts) return
          const dateStr = toDateString(ts)
          if (dateToDay[dateStr] !== undefined) return  // 이미 매핑됨
          const diffMs  = new Date(ts) - lastRealDate
          const diffDay = Math.round(diffMs / (1000 * 60 * 60 * 24))
          dateToDay[dateStr] = lastRealDay + diffDay
        })
      })
    }

    // 날짜 포맷 헬퍼: "2026.07.11 (120일)" 형식
    function formatLabel(dateStr) {
      const day = dateToDay[dateStr]
      const displayDate = dateStr.replace(/-/g, '.')
      return day !== undefined ? `${displayDate} (${day}일)` : displayDate
    }

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
      timeScale: { 
        borderColor: '#2B3139', 
        timeVisible: false,
        rightOffset: 5,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      localization: {
        timeFormatter: (ts) => {
          const dateStr = typeof ts === 'string'
            ? ts
            : toDateString(new Date(ts * 1000).toISOString())
          return formatLabel(dateStr)
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width:  containerRef.current.clientWidth  || 360,
      height: containerRef.current.clientHeight || 500,
    })
    chartRef.current = chart

    // ── 실제 데이터 선 (파란 실선) ──────────────────────────────
    const lineSeries = chart.addLineSeries({
      color: '#3B82F6', lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false,
    })
    const chartData = lineData
      .filter(d => d.timestamp)
      .map(d => ({ time: toDateString(d.timestamp), value: d.value }))
      .filter(d => d.time)

    // x축 확장: null/undefined 패딩 제거, rightOffset으로 처리


    lineSeries.setData(chartData)

    // ── 실제 박스: 수평선 대신 마커만 메인 라인에 표시 ──────────
    const boxMarkers = []
    boxes.forEach((box, idx) => {
      const startDate = toDateString(box.Start_Timestamp)
      const peakDate  = toDateString(box.Peak_Timestamp)
      if (!startDate) return

      const prevBox          = idx > 0 ? boxes[idx - 1] : null
      const prevPeakRate     = prevBox ? prevBox.Peak_Rate : 100
      const dropFromPrevHigh = ((prevPeakRate - box.Start_Rate) / prevPeakRate * 100).toFixed(1)
      const riseFromPrevLow  = ((box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100).toFixed(1)

      if (peakDate) {
        boxMarkers.push({
          time: peakDate, position: 'aboveBar', color: '#F6465D', shape: 'arrowDown',
          text: `H${idx + 1} ${box.Peak_Rate.toFixed(1)}% ↑${riseFromPrevLow}%`,
        })
      }
      boxMarkers.push({
        time: startDate, position: 'belowBar', color: '#0ECB81', shape: 'circle',
        text: `L${idx + 1} ${box.Start_Rate.toFixed(1)}% ↓${dropFromPrevHigh}%`,
      })
    })
    if (boxMarkers.length > 0) {
      boxMarkers.sort((a, b) => a.time.localeCompare(b.time))
      lineSeries.setMarkers(boxMarkers)
    }

    // ── 예측 박스 (최신 사이클에서만 API가 predictions 제공) ─────
    if (predictions.length > 0) {

      const addDays = (dateStr, n) => {
        const d = new Date(dateStr)
        d.setDate(d.getDate() + n)
        return toDateString(d.toISOString())
      }

      // 예측 박스를 일별 보간 데이터로 변환
      // 실제선 마지막값 → 첫 저점 → 고점 → 저점 → ... 순서로 매일 1포인트
      const buildDailyPredPath = (startTime, startValue, getVals) => {
        const pts = [{ time: startTime, value: startValue }]  // 실제선 마지막점 포함
        let lastDate  = new Date(startTime)
        let lastValue = startValue

        predictions.forEach((pred, i) => {
          const v = getVals(pred)
          if (!v) return

          const segments = i === 0
            ? [
                { toDate: new Date(v.s),  toValue: v.L },  // 실제 마지막→첫 저점
                { toDate: new Date(v.pk), toValue: v.H },  // 저점→고점
                { toDate: new Date(v.e),  toValue: v.L },  // 고점→저점
              ]
            : [
                { toDate: new Date(v.pk), toValue: v.H },  // 이전 저점→고점
                { toDate: new Date(v.e),  toValue: v.L },  // 고점→저점
              ]

          segments.forEach(seg => {
            const days = Math.round((seg.toDate - lastDate) / 86400000)
            if (days <= 0) return
            for (let j = 1; j <= days; j++) {
              const t = new Date(lastDate)
              t.setDate(t.getDate() + j)
              const ratio = j / days
              const value = Math.round((lastValue + (seg.toValue - lastValue) * ratio) * 100) / 100
              pts.push({ time: toDateString(t.toISOString()), value })
            }
            lastDate  = new Date(seg.toDate)
            lastValue = seg.toValue
          })
        })
        return pts
      }

      const day0 = chartData[chartData.length - 1]
      if (!day0) return

      const midMarkers = []
      const hiMarkers  = []
      const loMarkers  = []

      predictions.forEach((pred, idx) => {
        const startDate = toDateString(pred.Start_Timestamp)
        const peakDate  = toDateString(pred.Peak_Timestamp)
        const boxNum = boxes.length + idx + 1
        if (peakDate) {
          midMarkers.push({ time: peakDate, position: 'aboveBar', color: '#F59E0B', shape: 'arrowDown',
            text: `H${boxNum}? ${pred.Peak_Rate.toFixed(1)}% (ES)` })
        }
        midMarkers.push({ time: startDate, position: 'belowBar', color: '#9CA3AF', shape: 'circle',
          text: `L${boxNum}? ${pred.Start_Rate.toFixed(1)}% (ES)` })
        if (pred.Peak_Rate_Hi !== undefined && peakDate) {
          hiMarkers.push({ time: peakDate, position: 'aboveBar', color: '#10B981', shape: 'arrowDown',
            text: `H${boxNum}? ${pred.Peak_Rate_Hi.toFixed(1)}% (+1σ)` })
        }
        if (pred.Peak_Rate_Lo !== undefined && peakDate) {
          loMarkers.push({ time: peakDate, position: 'aboveBar', color: '#F6465D', shape: 'arrowDown',
            text: `H${boxNum}? ${pred.Peak_Rate_Lo.toFixed(1)}% (-1σ)` })
        }
      })

      const sortMarkers = (ms) => ms.sort((a, b) => a.time.localeCompare(b.time))

      // ── 주황 중앙선: 일별 보간 ──
      const midPath = buildDailyPredPath(day0.time, day0.value, pred => ({
        s: pred.Start_Timestamp, pk: pred.Peak_Timestamp, e: pred.End_Timestamp,
        L: pred.Start_Rate, H: pred.Peak_Rate,
      }))
      if (midPath.length > 1) {
        const midSeries = chart.addLineSeries({
          color: '#F59E0B', lineWidth: 2, lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        midSeries.setData(midPath)
        if (midMarkers.length > 0) midSeries.setMarkers(sortMarkers(midMarkers))
      }

      // ── 초록 낙관선: 일별 보간 ──
      const hiPath = buildDailyPredPath(day0.time, day0.value, pred => {
        if (pred.Peak_Rate_Hi === undefined) return null
        return {
          s: pred.Start_Timestamp, pk: pred.Peak_Timestamp, e: pred.End_Timestamp,
          L: pred.Start_Rate_Hi, H: pred.Peak_Rate_Hi,
        }
      })
      if (hiPath.length > 1) {
        const hiSeries = chart.addLineSeries({
          color: '#10B981', lineWidth: 1.5, lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        hiSeries.setData(hiPath)
        if (hiMarkers.length > 0) hiSeries.setMarkers(sortMarkers(hiMarkers))
      }

      // ── 빨강 비관선: 일별 보간 ──
      const loPath = buildDailyPredPath(day0.time, day0.value, pred => {
        if (pred.Peak_Rate_Lo === undefined) return null
        return {
          s: pred.Start_Timestamp, pk: pred.Peak_Timestamp, e: pred.End_Timestamp,
          L: pred.Start_Rate_Lo, H: pred.Peak_Rate_Lo,
        }
      })
      if (loPath.length > 1) {
        const loSeries = chart.addLineSeries({
          color: '#F6465D', lineWidth: 1.5, lineStyle: 2,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        })
        loSeries.setData(loPath)
        if (loMarkers.length > 0) loSeries.setMarkers(sortMarkers(loMarkers))
      }
    }

    // 초기 뷰: 전체 fitContent 후 예측 끝날짜까지 x축 포함
    chart.timeScale().fitContent()
    if (predictions.length > 0 && chartData.length > 0) {
      const lastPred     = predictions[predictions.length - 1]
      const lastPredDate = toDateString(lastPred.End_Timestamp)
      const firstDate    = chartData[0].time
      if (firstDate && lastPredDate) {
        chart.timeScale().setVisibleRange({ from: firstDate, to: lastPredDate })
      }
    }

    return () => {
      try { chartRef.current?.remove() } catch (_) {}
      chartRef.current = null
    }
  }, [lineData, boxes, predictions])

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

  const similarCycle = predictions[0]?.similarCycle

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
                Rise ≥{config.RISE_THRESHOLD}% | Break &lt;{config.BREAK_THRESHOLD}% | 0~400 Days
                {predictions.length > 0 && (
                  <span style={{ marginLeft: 8 }}>
                    <span style={{ color: '#F59E0B' }}>┆ 🔮 지수평활 예측 (α=0.4)</span>
                    {similarCycle && (
                      <span style={{ color: '#A78BFA', marginLeft: 6 }}>
                        ┆ 📐 C{similarCycle}과 가장 유사
                      </span>
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div
            ref={containerRef}
            className="chart-area"
            style={{ flex: 1, minHeight: 0, width: '100%' }}
          />

          <div className="chart-footer" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
            <span>
              <strong style={{ color: '#0ECB81' }}>박스: </strong>{boxes.length}개
              {predictions.length > 0 && (
                <>
                  <span style={{ color: '#F59E0B' }}>
                    &nbsp;+&nbsp;<strong>예측: </strong>{predictions.length}개
                  </span>
                  <span style={{ color: '#848E9C', marginLeft: 8 }}>
                    ─ <span style={{ color: '#F59E0B' }}>주황</span>:ES중앙
                    &nbsp;<span style={{ color: '#10B981' }}>초록</span>:낙관(+1σ)
                    &nbsp;<span style={{ color: '#F6465D' }}>빨강</span>:비관(-1σ)
                  </span>
                </>
              )}
              &nbsp;|&nbsp;
              <strong style={{ color: '#F6465D' }}>기간: </strong>0~400일
            </span>
            <span>Data: Supabase cycle data</span>
          </div>
        </div>
      </div>
    </div>
  )
}
