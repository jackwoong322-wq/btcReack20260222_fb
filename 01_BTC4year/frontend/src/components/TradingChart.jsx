import { useState, useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import { supabase } from '../lib/supabase'
import '../styles/Chart.css'

// RSI 계산
function calculateRSI(data, period = 14) {
  const rsi = []
  const changes = []
  
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i].close - data[i - 1].close)
  }
  
  for (let i = period; i < changes.length; i++) {
    const gains = []
    const losses = []
    
    for (let j = i - period; j < i; j++) {
      if (changes[j] > 0) gains.push(changes[j])
      else losses.push(Math.abs(changes[j]))
    }
    
    const avgGain = gains.length ? gains.reduce((a, b) => a + b, 0) / period : 0
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / period : 0
    
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    const rsiValue = 100 - (100 / (1 + rs))
    
    rsi.push({
      time: data[i + 1].time,
      value: rsiValue
    })
  }
  
  return rsi
}

// MACD 계산
function calculateMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const emaFast = calculateEMA(data, fastPeriod)
  const emaSlow = calculateEMA(data, slowPeriod)
  
  const macdLine = []
  const minLength = Math.min(emaFast.length, emaSlow.length)
  
  for (let i = 0; i < minLength; i++) {
    macdLine.push({
      time: emaFast[i].time,
      value: emaFast[i].value - emaSlow[i].value
    })
  }
  
  const signal = calculateEMA(macdLine, signalPeriod)
  const histogram = []
  
  for (let i = 0; i < signal.length; i++) {
    const macdValue = macdLine.find(m => m.time === signal[i].time)
    if (macdValue) {
      histogram.push({
        time: signal[i].time,
        value: macdValue.value - signal[i].value,
        color: macdValue.value >= signal[i].value ? '#0ECB81' : '#F6465D'
      })
    }
  }
  
  return { macdLine, signal, histogram }
}

// EMA 계산
function calculateEMA(data, period) {
  const ema = []
  const multiplier = 2 / (period + 1)
  
  // 첫 EMA는 SMA로 시작
  let sum = 0
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i].value || data[i].close
  }
  let prevEMA = sum / period
  
  for (let i = period - 1; i < data.length; i++) {
    const value = data[i].value || data[i].close
    const currentEMA = (value - prevEMA) * multiplier + prevEMA
    ema.push({
      time: data[i].time,
      value: currentEMA
    })
    prevEMA = currentEMA
  }
  
  return ema
}

// MA 계산
function calculateMA(data, period) {
  const ma = []
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close
    }
    ma.push({
      time: data[i].time,
      value: sum / period
    })
  }
  return ma
}

export default function TradingChart() {
  const mainChartRef = useRef(null)
  const volumeChartRef = useRef(null)
  const rsiChartRef = useRef(null)
  const macdChartRef = useRef(null)
  
  const mainChartInstanceRef = useRef(null)
  const volumeChartInstanceRef = useRef(null)
  const rsiChartInstanceRef = useRef(null)
  const macdChartInstanceRef = useRef(null)
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showMA, setShowMA] = useState({ ma20: true, ma50: true, ma200: true })
  const [currentPrice, setCurrentPrice] = useState(null)
  const [priceChange, setPriceChange] = useState(null)
  
  // 차트 데이터 state
  const [chartData, setChartData] = useState(null)

  // 데이터 로드
  useEffect(() => {
    loadData()
    
    return () => {
      if (mainChartInstanceRef.current) mainChartInstanceRef.current.remove()
      if (volumeChartInstanceRef.current) volumeChartInstanceRef.current.remove()
      if (rsiChartInstanceRef.current) rsiChartInstanceRef.current.remove()
      if (macdChartInstanceRef.current) macdChartInstanceRef.current.remove()
    }
  }, [])

  // 차트 생성 - 데이터 로드 완료 후 & ref가 준비된 후
  useEffect(() => {
    if (!chartData || loading) return
    
    // DOM이 렌더링될 시간을 주기 위해 setTimeout 사용
    const timer = setTimeout(() => {
      if (!mainChartRef.current) {
        console.log('ref 아직 준비 안됨, 재시도...')
        return
      }
      
      console.log('차트 생성 시작 - ref 준비됨')
      createCharts(
        chartData.candleData,
        chartData.volumeData,
        chartData.maData,
        chartData.rsiData,
        chartData.macdData
      )
    }, 100)
    
    return () => clearTimeout(timer)
  }, [chartData, loading])

  useEffect(() => {
    if (!mainChartInstanceRef.current) return
    
    const handleResize = () => {
      const width = mainChartRef.current?.clientWidth || 800
      
      if (mainChartInstanceRef.current) {
        mainChartInstanceRef.current.applyOptions({ width })
      }
      if (volumeChartInstanceRef.current) {
        volumeChartInstanceRef.current.applyOptions({ width })
      }
      if (rsiChartInstanceRef.current) {
        rsiChartInstanceRef.current.applyOptions({ width })
      }
      if (macdChartInstanceRef.current) {
        macdChartInstanceRef.current.applyOptions({ width })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      
      // 전체 데이터를 페이지네이션으로 가져오기
      let allData = []
      let offset = 0
      const batchSize = 1000
      
      while (true) {
        const { data, error: fetchError } = await supabase
          .from('ohlcv_1day')
          .select('timestamp, readable_time, open, high, low, close, volume')
          .order('timestamp', { ascending: true })
          .range(offset, offset + batchSize - 1)

        if (fetchError) throw fetchError
        if (!data || data.length === 0) break

        allData = [...allData, ...data]
        
        // 더 이상 데이터가 없으면 중단
        if (data.length < batchSize) break
        
        offset += batchSize
      }

      if (allData.length === 0) throw new Error('데이터 없음')

      console.log(`총 ${allData.length}개 데이터 로드 완료`)

      // 데이터 변환
      const candleData = allData.map(d => ({
        time: d.readable_time.split('T')[0], // 'YYYY-MM-DD' 형식
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close
      }))

      const volumeData = allData.map(d => ({
        time: d.readable_time.split('T')[0], // 'YYYY-MM-DD' 형식
        value: d.volume,
        color: d.close >= d.open ? '#0ECB8180' : '#F6465D80'
      }))

      // 이동평균 계산
      const ma20 = calculateMA(candleData, 20)
      const ma50 = calculateMA(candleData, 50)
      const ma200 = calculateMA(candleData, 200)

      // RSI 계산
      const rsiData = calculateRSI(candleData, 14)

      // MACD 계산
      const { macdLine, signal, histogram } = calculateMACD(candleData)

      // 데이터를 state에 저장 (차트 생성은 별도 useEffect에서)
      setChartData({
        candleData,
        volumeData,
        maData: { ma20, ma50, ma200 },
        rsiData,
        macdData: { macdLine, signal, histogram }
      })

      // 현재가 설정
      const lastCandle = candleData[candleData.length - 1]
      setCurrentPrice(lastCandle.close)
      
      if (candleData.length > 1) {
        const prevClose = candleData[candleData.length - 2].close
        const change = ((lastCandle.close - prevClose) / prevClose) * 100
        setPriceChange(change)
      }

      setLoading(false)
    } catch (err) {
      console.error('데이터 로드 실패:', err)
      setError(err.message)
      setLoading(false)
    }
  }

  function createCharts(candleData, volumeData, maData, rsiData, macdData) {
    console.log('=== createCharts 호출 ===')
    console.log('mainChartRef.current:', mainChartRef.current)
    console.log('mainChartRef.current?.clientWidth:', mainChartRef.current?.clientWidth)
    console.log('candleData 개수:', candleData.length)
    
    if (!mainChartRef.current) {
      console.error('mainChartRef.current가 null입니다!')
      return
    }
    
    const chartOptions = {
      layout: {
        background: { color: '#0B0E11' },
        textColor: '#848E9C',
      },
      localization: {
        dateFormat: 'yyyy-MM-dd',
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

    // 메인 차트 (캔들스틱)
    if (mainChartRef.current) {
      console.log('메인 차트 생성 시작')
      const mainChart = createChart(mainChartRef.current, {
        ...chartOptions,
        width: mainChartRef.current.clientWidth || 800,
        height: 400,
      })
      console.log('메인 차트 생성 완료:', mainChart)
      mainChartInstanceRef.current = mainChart

      const candleSeries = mainChart.addCandlestickSeries({
        upColor: '#0ECB81',
        downColor: '#F6465D',
        borderUpColor: '#0ECB81',
        borderDownColor: '#F6465D',
        wickUpColor: '#0ECB81',
        wickDownColor: '#F6465D',
      })
      candleSeries.setData(candleData)

      // 이동평균선
      if (showMA.ma20) {
        const ma20Series = mainChart.addLineSeries({
          color: '#FFA500',
          lineWidth: 1,
          title: 'MA20',
        })
        ma20Series.setData(maData.ma20)
      }

      if (showMA.ma50) {
        const ma50Series = mainChart.addLineSeries({
          color: '#00BFFF',
          lineWidth: 1,
          title: 'MA50',
        })
        ma50Series.setData(maData.ma50)
      }

      if (showMA.ma200) {
        const ma200Series = mainChart.addLineSeries({
          color: '#FF1493',
          lineWidth: 2,
          title: 'MA200',
        })
        ma200Series.setData(maData.ma200)
      }

      mainChart.timeScale().fitContent()
    }

    // 볼륨 차트
    if (volumeChartRef.current) {
      const volumeChart = createChart(volumeChartRef.current, {
        ...chartOptions,
        width: volumeChartRef.current.clientWidth,
        height: 100,
      })
      volumeChartInstanceRef.current = volumeChart

      const volumeSeries = volumeChart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      })
      volumeSeries.setData(volumeData)

      volumeChart.timeScale().fitContent()
    }

    // RSI 차트
    if (rsiChartRef.current) {
      const rsiChart = createChart(rsiChartRef.current, {
        ...chartOptions,
        width: rsiChartRef.current.clientWidth,
        height: 100,
      })
      rsiChartInstanceRef.current = rsiChart

      const rsiSeries = rsiChart.addLineSeries({
        color: '#9333EA',
        lineWidth: 2,
      })
      rsiSeries.setData(rsiData)

      // RSI 기준선 (70, 30)
      rsiSeries.createPriceLine({
        price: 70,
        color: '#EF4444',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Overbought',
      })

      rsiSeries.createPriceLine({
        price: 30,
        color: '#10B981',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Oversold',
      })

      rsiChart.timeScale().fitContent()
    }

    // MACD 차트
    if (macdChartRef.current) {
      const macdChart = createChart(macdChartRef.current, {
        ...chartOptions,
        width: macdChartRef.current.clientWidth,
        height: 100,
      })
      macdChartInstanceRef.current = macdChart

      // Histogram
      const histogramSeries = macdChart.addHistogramSeries({
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      })
      histogramSeries.setData(macdData.histogram)

      // MACD Line
      const macdLineSeries = macdChart.addLineSeries({
        color: '#2962FF',
        lineWidth: 2,
      })
      macdLineSeries.setData(macdData.macdLine)

      // Signal Line
      const signalSeries = macdChart.addLineSeries({
        color: '#FF6D00',
        lineWidth: 2,
      })
      signalSeries.setData(macdData.signal)

      macdChart.timeScale().fitContent()
    }
  }

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
            padding: '16px 20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
              <h2 style={{ color: '#EAECEF', margin: 0, fontSize: '20px' }}>BTC/USDT</h2>
              {currentPrice && (
                <>
                  <span style={{ color: '#EAECEF', fontSize: '24px', fontWeight: 600 }}>
                    ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {priceChange !== null && (
                    <span style={{ 
                      color: priceChange >= 0 ? '#0ECB81' : '#F6465D',
                      fontSize: '14px',
                      fontWeight: 500
                    }}>
                      {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                    </span>
                  )}
                </>
              )}
            </div>

            {/* 인디케이터 토글 */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showMA.ma20}
                  onChange={(e) => {
                    setShowMA(prev => ({ ...prev, ma20: e.target.checked }))
                    loadData()
                  }}
                />
                <span style={{ color: '#FFA500', fontSize: '12px' }}>MA20</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showMA.ma50}
                  onChange={(e) => {
                    setShowMA(prev => ({ ...prev, ma50: e.target.checked }))
                    loadData()
                  }}
                />
                <span style={{ color: '#00BFFF', fontSize: '12px' }}>MA50</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showMA.ma200}
                  onChange={(e) => {
                    setShowMA(prev => ({ ...prev, ma200: e.target.checked }))
                    loadData()
                  }}
                />
                <span style={{ color: '#FF1493', fontSize: '12px' }}>MA200</span>
              </label>
            </div>
          </div>

          {/* 차트 영역 */}
          <div style={{ background: '#0B0E11', padding: '0' }}>
            {/* 메인 차트 (캔들스틱 + MA) */}
            <div ref={mainChartRef} style={{ width: '100%', height: '400px' }} />
            
            {/* 볼륨 */}
            <div style={{ padding: '8px 20px 0', color: '#848E9C', fontSize: '11px' }}>Volume</div>
            <div ref={volumeChartRef} style={{ width: '100%', height: '100px' }} />
            
            {/* RSI */}
            <div style={{ padding: '8px 20px 0', color: '#848E9C', fontSize: '11px' }}>RSI (14)</div>
            <div ref={rsiChartRef} style={{ width: '100%', height: '100px' }} />
            
            {/* MACD */}
            <div style={{ padding: '8px 20px 0', color: '#848E9C', fontSize: '11px' }}>MACD (12, 26, 9)</div>
            <div ref={macdChartRef} style={{ width: '100%', height: '100px' }} />
          </div>

          {/* 푸터 */}
          <div style={{ 
            background: '#0B0E11',
            borderTop: '1px solid #2B3139',
            padding: '12px 20px',
            color: '#848E9C',
            fontSize: '12px'
          }}>
            <div style={{ display: 'flex', gap: '24px' }}>
              <span>🖱️ Drag: Pan</span>
              <span>🔍 Wheel: Zoom</span>
              <span>📱 Pinch: Touch Zoom</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
