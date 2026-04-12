import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useBearBoxData } from '../hooks/useChartData'
import { useResizeChart } from '../hooks/useResizeChart'
import { CHART_THEME } from '../utils/chartConstants'
import { ChartErrorState, ChartLoadingState } from './ChartStatus'
import '../styles/Chart.css'

function toDateString(timestamp) {
  if (!timestamp) return null
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function BearBoxChart({ cycleNumber = 4 }) {
  const { lineData, boxes, predictions, loading, error, cycleInfo, config } = useBearBoxData(cycleNumber)
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

    if (predictions.length > 0 && lineData.length > 0) {
      const lastReal = lineData[lineData.length - 1]
      const lastRealDate = new Date(lastReal.timestamp)
      const lastRealDay = lastReal.day

      predictions.forEach((prediction) => {
        ;[prediction.Start_Timestamp, prediction.Peak_Timestamp, prediction.End_Timestamp].forEach((timestamp) => {
          if (!timestamp) return
          const dateStr = toDateString(timestamp)
          if (dateToDay[dateStr] !== undefined) return
          const diffMs = new Date(timestamp) - lastRealDate
          const diffDay = Math.round(diffMs / (1000 * 60 * 60 * 24))
          dateToDay[dateStr] = lastRealDay + diffDay
        })
      })
    }

    function formatLabel(dateStr) {
      const day = dateToDay[dateStr]
      const displayDate = dateStr.replace(/-/g, '.')
      return day !== undefined ? `${displayDate} (${day}일)` : displayDate
    }

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
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: false,
        rightOffset: 5,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      localization: {
        timeFormatter: (timestamp) => {
          const dateStr = typeof timestamp === 'string'
            ? timestamp
            : toDateString(new Date(timestamp * 1000).toISOString())
          return formatLabel(dateStr)
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      width: containerRef.current.clientWidth || 360,
      height: containerRef.current.clientHeight || 500,
    })
    chartRef.current = chart

    const lineSeries = chart.addLineSeries({
      color: CHART_THEME.info,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    })

    const chartData = lineData
      .filter((item) => item.timestamp)
      .map((item) => ({ time: toDateString(item.timestamp), value: item.value }))
      .filter((item) => item.time)

    lineSeries.setData(chartData)

    const boxMarkers = []
    boxes.forEach((box, idx) => {
      const startDate = toDateString(box.Start_Timestamp)
      const peakDate = toDateString(box.Peak_Timestamp)
      if (!startDate) return

      const prevBox = idx > 0 ? boxes[idx - 1] : null
      const prevPeakRate = prevBox ? prevBox.Peak_Rate : 100
      const dropFromPrevHigh = ((prevPeakRate - box.Start_Rate) / prevPeakRate * 100).toFixed(1)
      const riseFromPrevLow = ((box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100).toFixed(1)

      if (peakDate) {
        boxMarkers.push({
          time: peakDate,
          position: 'aboveBar',
          color: CHART_THEME.danger,
          shape: 'arrowDown',
          text: `H${idx + 1} ${box.Peak_Rate.toFixed(1)}% (+${riseFromPrevLow}%)`,
        })
      }
      boxMarkers.push({
        time: startDate,
        position: 'belowBar',
        color: CHART_THEME.success,
        shape: 'circle',
        text: `L${idx + 1} ${box.Start_Rate.toFixed(1)}% (-${dropFromPrevHigh}%)`,
      })
    })

    if (boxMarkers.length > 0) {
      boxMarkers.sort((a, b) => a.time.localeCompare(b.time))
      lineSeries.setMarkers(boxMarkers)
    }

    if (predictions.length > 0) {
      const buildDailyPredPath = (startTime, startValue, getValues) => {
        const points = [{ time: startTime, value: startValue }]
        let lastDate = new Date(startTime)
        let lastValue = startValue

        predictions.forEach((prediction, index) => {
          const values = getValues(prediction)
          if (!values) return

          const segments = index === 0
            ? [
                { toDate: new Date(values.s), toValue: values.L },
                { toDate: new Date(values.pk), toValue: values.H },
                { toDate: new Date(values.e), toValue: values.L },
              ]
            : [
                { toDate: new Date(values.pk), toValue: values.H },
                { toDate: new Date(values.e), toValue: values.L },
              ]

          segments.forEach((segment) => {
            const days = Math.round((segment.toDate - lastDate) / 86400000)
            if (days <= 0) return
            for (let step = 1; step <= days; step++) {
              const nextDate = new Date(lastDate)
              nextDate.setDate(nextDate.getDate() + step)
              const ratio = step / days
              const value = Math.round((lastValue + (segment.toValue - lastValue) * ratio) * 100) / 100
              points.push({ time: toDateString(nextDate.toISOString()), value })
            }
            lastDate = new Date(segment.toDate)
            lastValue = segment.toValue
          })
        })

        return points
      }

      const basePoint = chartData[chartData.length - 1]
      if (!basePoint) return

      const midMarkers = []
      const hiMarkers = []
      const loMarkers = []

      predictions.forEach((prediction, idx) => {
        const startDate = toDateString(prediction.Start_Timestamp)
        const peakDate = toDateString(prediction.Peak_Timestamp)
        const boxNumber = boxes.length + idx + 1

        if (peakDate) {
          midMarkers.push({
            time: peakDate,
            position: 'aboveBar',
            color: CHART_THEME.accent,
            shape: 'arrowDown',
            text: `H${boxNumber} ${prediction.Peak_Rate.toFixed(1)}% (중앙값)`,
          })
        }
        midMarkers.push({
          time: startDate,
          position: 'belowBar',
          color: CHART_THEME.textMuted,
          shape: 'circle',
          text: `L${boxNumber} ${prediction.Start_Rate.toFixed(1)}% (중앙값)`,
        })

        if (prediction.Peak_Rate_Hi !== undefined && peakDate) {
          hiMarkers.push({
            time: peakDate,
            position: 'aboveBar',
            color: CHART_THEME.success,
            shape: 'arrowDown',
            text: `H${boxNumber} ${prediction.Peak_Rate_Hi.toFixed(1)}% (+1σ)`,
          })
        }
        if (prediction.Peak_Rate_Lo !== undefined && peakDate) {
          loMarkers.push({
            time: peakDate,
            position: 'aboveBar',
            color: CHART_THEME.danger,
            shape: 'arrowDown',
            text: `H${boxNumber} ${prediction.Peak_Rate_Lo.toFixed(1)}% (-1σ)`,
          })
        }
      })

      const sortMarkers = (markers) => markers.sort((a, b) => a.time.localeCompare(b.time))

      const midPath = buildDailyPredPath(basePoint.time, basePoint.value, (prediction) => ({
        s: prediction.Start_Timestamp,
        pk: prediction.Peak_Timestamp,
        e: prediction.End_Timestamp,
        L: prediction.Start_Rate,
        H: prediction.Peak_Rate,
      }))
      if (midPath.length > 1) {
        const midSeries = chart.addLineSeries({
          color: CHART_THEME.accent,
          lineWidth: 2,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        midSeries.setData(midPath)
        if (midMarkers.length > 0) midSeries.setMarkers(sortMarkers(midMarkers))
      }

      const hiPath = buildDailyPredPath(basePoint.time, basePoint.value, (prediction) => {
        if (prediction.Peak_Rate_Hi === undefined) return null
        return {
          s: prediction.Start_Timestamp,
          pk: prediction.Peak_Timestamp,
          e: prediction.End_Timestamp,
          L: prediction.Start_Rate_Hi,
          H: prediction.Peak_Rate_Hi,
        }
      })
      if (hiPath.length > 1) {
        const hiSeries = chart.addLineSeries({
          color: CHART_THEME.success,
          lineWidth: 1.5,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        hiSeries.setData(hiPath)
        if (hiMarkers.length > 0) hiSeries.setMarkers(sortMarkers(hiMarkers))
      }

      const loPath = buildDailyPredPath(basePoint.time, basePoint.value, (prediction) => {
        if (prediction.Peak_Rate_Lo === undefined) return null
        return {
          s: prediction.Start_Timestamp,
          pk: prediction.Peak_Timestamp,
          e: prediction.End_Timestamp,
          L: prediction.Start_Rate_Lo,
          H: prediction.Peak_Rate_Lo,
        }
      })
      if (loPath.length > 1) {
        const loSeries = chart.addLineSeries({
          color: CHART_THEME.danger,
          lineWidth: 1.5,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        loSeries.setData(loPath)
        if (loMarkers.length > 0) loSeries.setMarkers(sortMarkers(loMarkers))
      }
    }

    chart.timeScale().fitContent()
    if (predictions.length > 0 && chartData.length > 0) {
      const lastPrediction = predictions[predictions.length - 1]
      const lastPredictionDate = toDateString(lastPrediction.End_Timestamp)
      const firstDate = chartData[0].time
      if (firstDate && lastPredictionDate) {
        chart.timeScale().setVisibleRange({ from: firstDate, to: lastPredictionDate })
      }
    }

    return () => {
      try {
        chartRef.current?.remove()
      } catch (_) {}
      chartRef.current = null
    }
  }, [lineData, boxes, predictions])

  if (loading) {
    return (
      <div className="chart-page"><div className="chart-container">
        <ChartLoadingState
          title="데이터를 불러오는 중입니다..."
          message="Bear Market Box와 예측 구간을 준비하고 있습니다."
        />
      </div></div>
    )
  }

  if (error) {
    return (
      <div className="chart-page"><div className="chart-container">
        <ChartErrorState
          title="Bear Market Box 데이터를 불러오지 못했습니다."
          message={error}
        />
      </div></div>
    )
  }

  const similarCycle = predictions[0]?.similarCycle

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">
          <div className="chart-header">
            <div className="chart-meta">
              <span className="chart-eyebrow">Bear Box</span>
              <h2 className="chart-title">
                Cycle {cycleNumber} ({cycleInfo.startDate}) Bear Market Box
              </h2>
              <p className="chart-description">
                Rise ≥ {config.RISE_THRESHOLD}% | Break &lt; {config.BREAK_THRESHOLD}% | 0~400 Days
                {predictions.length > 0 && (
                  <span className="chart-note-inline">
                    <span className="chart-note-accent">예측 중심선 표시</span>
                    {similarCycle && <span className="chart-note-violet">유사 사이클: C{similarCycle}</span>}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div ref={containerRef} className="chart-area chart-area-fill" />

          <div className="chart-footer chart-footer-row">
            <span>
              <strong className="chart-strong-success">박스:</strong> {boxes.length}개
              {predictions.length > 0 && (
                <>
                  <span className="chart-strong-accent">
                    &nbsp;+&nbsp;<strong>예측:</strong> {predictions.length}개
                  </span>
                  <span className="chart-note-soft chart-note-inline">
                    <span className="chart-legend legend-accent"><span className="chart-legend-dot" />중앙값</span>
                    &nbsp;<span className="chart-legend legend-success"><span className="chart-legend-dot" />상단 밴드</span>
                    &nbsp;<span className="chart-legend legend-danger"><span className="chart-legend-dot" />하단 밴드</span>
                  </span>
                </>
              )}
              &nbsp;|&nbsp;
              <strong className="chart-strong-danger">기간:</strong> 0~400일
            </span>
            <span>Data: Supabase cycle data</span>
          </div>
        </div>
      </div>
    </div>
  )
}
