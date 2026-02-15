import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { useBearBoxData } from '../hooks/useChartData'
import '../styles/Chart.css'

// timestamp를 yyyy-mm-dd 형식으로 변환
function toDateString(timestamp) {
  if (!timestamp) return null
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default function BearBoxChart({ cycleNumber = 4 }) {
  const { lineData, boxes, loading, error, cycleInfo, config } = useBearBoxData(cycleNumber)
  const chartContainerRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!chartContainerRef.current || lineData.length === 0) return

    // 날짜 → Day 매핑 생성
    const dateToDay = {}
    lineData.forEach(d => {
      if (d.timestamp) {
        const dateStr = toDateString(d.timestamp)
        dateToDay[dateStr] = d.day
      }
    })

    // 기존 차트 제거
    if (chartRef.current) {
      try {
        chartRef.current.remove()
      } catch (e) {}
      chartRef.current = null
    }

    // 차트 생성
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0B0E11' },
        textColor: '#848E9C',
      },
      grid: {
        vertLines: { color: '#1C2127' },
        horzLines: { color: '#1C2127' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2B3139',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: 3,
          labelBackgroundColor: '#2B3139',
        },
      },
      rightPriceScale: {
        borderColor: '#2B3139',
      },
      timeScale: {
        borderColor: '#2B3139',
        timeVisible: false,
      },
      localization: {
        // 크로스헤어 라벨을 "Day N" 형식으로 표시
        timeFormatter: (businessDayOrTimestamp) => {
          // businessDayOrTimestamp가 문자열(yyyy-mm-dd)인 경우
          if (typeof businessDayOrTimestamp === 'string') {
            const day = dateToDay[businessDayOrTimestamp]
            return day !== undefined ? `Day ${day}` : businessDayOrTimestamp
          }
          // 숫자(timestamp)인 경우
          const date = new Date(businessDayOrTimestamp * 1000)
          const dateStr = toDateString(date.toISOString())
          const day = dateToDay[dateStr]
          return day !== undefined ? `Day ${day}` : dateStr
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
      height: 600,
    })

    chartRef.current = chart

    // 메인 라인 시리즈
    const lineSeries = chart.addLineSeries({
      color: '#3B82F6',
      lineWidth: 2,
    })

    // 날짜 기반 데이터 변환
    const chartData = lineData
      .filter(d => d.timestamp)
      .map(d => ({
        time: toDateString(d.timestamp),
        value: d.value,
      }))
      .filter(d => d.time)

    lineSeries.setData(chartData)

    // 마커 배열
    const allMarkers = []

    // 박스 그리기
    boxes.forEach((box, idx) => {
      const startDate = toDateString(box.Start_Timestamp)
      const endDate = toDateString(box.End_Timestamp)
      const peakDate = toDateString(box.Peak_Timestamp)

      if (!startDate || !endDate) return

      // 이전 박스 정보 (상승률/하락률 계산용)
      const prevBox = idx > 0 ? boxes[idx - 1] : null
      const prevPeakRate = prevBox ? prevBox.Peak_Rate : 100 // 첫 박스는 100% 기준
      const prevLowRate = prevBox ? prevBox.Start_Rate : box.Start_Rate

      // 저점에서 이전 고점 대비 하락률
      const dropFromPrevHigh = ((prevPeakRate - box.Start_Rate) / prevPeakRate * 100).toFixed(1)
      // 고점에서 이전 저점 대비 상승률
      const riseFromPrevLow = ((box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100).toFixed(1)

      // 박스 상단 라인 (고점)
      const topLine = chart.addLineSeries({
        color: '#F6465D',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })

      // 박스 하단 라인 (저점)
      const bottomLine = chart.addLineSeries({
        color: '#0ECB81',
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })

      topLine.setData([
        { time: startDate, value: box.Peak_Rate },
        { time: endDate, value: box.Peak_Rate },
      ])

      bottomLine.setData([
        { time: startDate, value: box.Start_Rate },
        { time: endDate, value: box.Start_Rate },
      ])

      // 고점 마커 - 이전 저점 대비 상승률 표시
      if (peakDate) {
        allMarkers.push({
          time: peakDate,
          position: 'aboveBar',
          color: '#F6465D',
          shape: 'arrowDown',
          text: `H${idx + 1} ${box.Peak_Rate.toFixed(1)}% ↑${riseFromPrevLow}%`,
        })
      }

      // 저점 마커 - 이전 고점 대비 하락률 표시
      if (startDate) {
        allMarkers.push({
          time: startDate,
          position: 'belowBar',
          color: '#0ECB81',
          shape: 'circle',
          text: `L${idx + 1} ${box.Start_Rate.toFixed(1)}% ↓${dropFromPrevHigh}%`,
        })
      }
    })

    // 마커 정렬 후 설정
    allMarkers.sort((a, b) => a.time.localeCompare(b.time))
    if (allMarkers.length > 0) {
      lineSeries.setMarkers(allMarkers)
    }

    // 반응형
    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        })
      }
    }

    window.addEventListener('resize', handleResize)
    chart.timeScale().fitContent()

    return () => {
      window.removeEventListener('resize', handleResize)
      if (chartRef.current) {
        try {
          chartRef.current.remove()
        } catch (e) {}
      }
    }
  }, [lineData, boxes])

  if (loading) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <div className="loading-container">데이터 로딩 중...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="chart-page">
        <div className="chart-container">
          <div className="error-container">오류: {error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="chart-page">
      <div className="chart-container">
        <div className="chart-wrapper">
          {/* 헤더 */}
          <div className="chart-header" style={{
            background: '#0B0E11',
            borderBottom: '1px solid #2B3139',
            padding: '16px 20px',
          }}>
            <h2 style={{ color: '#EAECEF', margin: 0, fontSize: '20px' }}>
              🐻 Cycle {cycleNumber} ({cycleInfo.startDate}) - Bear Market Box
            </h2>
            <p style={{ color: '#848E9C', margin: '4px 0 0 0', fontSize: '12px' }}>
              Rise ≥{config.RISE_THRESHOLD}% | Break &lt;{config.BREAK_THRESHOLD}% | 0~420 Days
            </p>
          </div>

          {/* 차트 */}
          <div
            ref={chartContainerRef}
            style={{ width: '100%', height: '600px', background: '#0B0E11' }}
          />

          {/* 푸터 */}
          <div style={{
            background: '#0B0E11',
            borderTop: '1px solid #2B3139',
            padding: '12px 20px',
            color: '#848E9C',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <strong style={{ color: '#0ECB81' }}>박스: </strong>{boxes.length}개
              <span style={{ margin: '0 12px' }}>|</span>
              <strong style={{ color: '#F6465D' }}>기간: </strong>0~420일
            </div>
            <div style={{ fontSize: '11px' }}>
              Data: Supabase bitcoin_cycle_data
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
