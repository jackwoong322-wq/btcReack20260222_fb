import { useState, useEffect } from 'react'
import {
  fetchCycleData,
  groupByCycle,
  createCycleComparisonSeries,
  calculateBearBoxes,
  calculateBullBoxes,
  createBearLineData,
  createBullLineData,
  calculateBearPrediction,
  BEAR_CONFIG,
  BULL_CONFIG,
} from '../utils/chartData'

export function useCycleComparisonData() {
  const [series, setSeries] = useState([])
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [maxDays, setMaxDays] = useState(0)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const data = await fetchCycleData()

        if (!data || data.length === 0) {
          setError('데이터를 찾을 수 없습니다.')
          return
        }

        const cycles = groupByCycle(data)
        const seriesData = createCycleComparisonSeries(cycles)
        const max = Math.max(...data.map(d => d.days_since_peak))

        // Cycle 4 예측 계산 (선형회귀 기반)
        const bearData = await fetchCycleData(BEAR_CONFIG.MAX_DURATION_DAYS)
        if (bearData && bearData.length > 0) {
          const bearCycles = groupByCycle(bearData)
          const allCycleBoxes = {}
          ;[1, 2, 3].forEach(cn => {
            if (bearCycles[cn]) allCycleBoxes[cn] = calculateBearBoxes(bearCycles[cn], cn)
          })
          const cycle4Data  = bearCycles[4] || []
          const cycle4Boxes = calculateBearBoxes(cycle4Data, 4)
          const cycle4Line  = createBearLineData(cycle4Data, cycle4Boxes)
          const pred = calculateBearPrediction(allCycleBoxes, cycle4Boxes, cycle4Line)
          setPredictions(pred)
        }

        setSeries(seriesData)
        setMaxDays(max)
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  return { series, predictions, loading, error, maxDays }
}

export function useBearBoxData(cycleNumber = 4) {
  const [lineData, setLineData] = useState([])
  const [boxes, setBoxes] = useState([])
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cycleInfo, setCycleInfo] = useState({ startDate: '', endDate: '' })

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const data = await fetchCycleData(BEAR_CONFIG.MAX_DURATION_DAYS)

        if (!data || data.length === 0) {
          setError('데이터를 찾을 수 없습니다.')
          return
        }

        const cycles = groupByCycle(data)
        const cycleData = cycles[cycleNumber]

        if (!cycleData || cycleData.length === 0) {
          setError(`사이클 ${cycleNumber} 데이터를 찾을 수 없습니다.`)
          return
        }

        const calculatedBoxes = calculateBearBoxes(cycleData, cycleNumber)
        const lineDataWithBoxes = createBearLineData(cycleData, calculatedBoxes)

        setBoxes(calculatedBoxes)
        setLineData(lineDataWithBoxes)
        setCycleInfo({
          startDate: cycleData[0]?.timestamp ? new Date(cycleData[0].timestamp).toISOString().slice(0, 7).replace('-', '.') : '',
          endDate: cycleData[cycleData.length - 1]?.timestamp ? new Date(cycleData[cycleData.length - 1].timestamp).toISOString().slice(0, 7).replace('-', '.') : '',
        })

        // Cycle 4 전용 예측: 같은 데이터로 바로 계산
        if (cycleNumber === 4) {
          const allCycleBoxes = {}
          ;[1, 2, 3].forEach(cn => {
            if (cycles[cn]) allCycleBoxes[cn] = calculateBearBoxes(cycles[cn], cn)
          })
          const pred = calculateBearPrediction(allCycleBoxes, calculatedBoxes, lineDataWithBoxes)
          setPredictions(pred)
        } else {
          setPredictions([])
        }

        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [cycleNumber])

  return { lineData, boxes, predictions, loading, error, cycleInfo, config: BEAR_CONFIG }
}

export function useBearPrediction(cycleNumber = 4) {
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(cycleNumber === 4)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Cycle 4 전용 예측 — 다른 사이클은 빈 배열 즉시 반환
    if (cycleNumber !== 4) {
      setPredictions([])
      setLoading(false)
      return
    }

    async function loadData() {
      try {
        setLoading(true)
        const data = await fetchCycleData(BEAR_CONFIG.MAX_DURATION_DAYS)
        if (!data || data.length === 0) {
          setError('데이터를 찾을 수 없습니다.')
          return
        }

        const cycles = groupByCycle(data)

        // Cycle 1~3 박스 계산
        const allCycleBoxes = {}
        ;[1, 2, 3].forEach(cn => {
          if (cycles[cn]) allCycleBoxes[cn] = calculateBearBoxes(cycles[cn], cn)
        })

        // Cycle 4 박스 + lineData
        const cycle4Data = cycles[4] || []
        const cycle4Boxes = calculateBearBoxes(cycle4Data, 4)
        const cycle4LineData = createBearLineData(cycle4Data, cycle4Boxes)

        const pred = calculateBearPrediction(allCycleBoxes, cycle4Boxes, cycle4LineData)
        setPredictions(pred)
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [cycleNumber])

  return { predictions, loading, error }
}

export function useBullBoxData(cycleNumber = 3) {
  const [lineData, setLineData] = useState([])
  const [boxes, setBoxes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cycleInfo, setCycleInfo] = useState({ startDate: '', endDate: '', maxDays: 0 })

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const data = await fetchCycleData(BULL_CONFIG.MAX_DAYS_FROM_PEAK, BULL_CONFIG.MIN_DAYS_FROM_PEAK)
        
        if (!data || data.length === 0) {
          setError('데이터를 찾을 수 없습니다.')
          return
        }

        const cycles = groupByCycle(data)
        const cycleData = cycles[cycleNumber]
        
        if (!cycleData || cycleData.length === 0) {
          setError(`사이클 ${cycleNumber} 데이터를 찾을 수 없습니다.`)
          return
        }

        const calculatedBoxes = calculateBullBoxes(cycleData, cycleNumber)
        const lineDataWithBoxes = createBullLineData(cycleData, calculatedBoxes)
        const maxDays = Math.max(...cycleData.map(d => d.day))

        setBoxes(calculatedBoxes)
        setLineData(lineDataWithBoxes)
        setCycleInfo({
          startDate: cycleData[0]?.timestamp ? new Date(cycleData[0].timestamp).toISOString().slice(0, 7).replace('-', '.') : '',
          endDate: cycleData[cycleData.length - 1]?.timestamp ? new Date(cycleData[cycleData.length - 1].timestamp).toISOString().slice(0, 7).replace('-', '.') : '',
          maxDays,
        })
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [cycleNumber])

  return { lineData, boxes, loading, error, cycleInfo, config: BULL_CONFIG }
}
