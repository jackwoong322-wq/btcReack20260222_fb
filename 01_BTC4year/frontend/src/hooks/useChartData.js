import { useState, useEffect } from 'react'
import {
  fetchCycleData,
  groupByCycle,
  createCycleComparisonSeries,
  calculateBearBoxes,
  calculateBullBoxes,
  createBearLineData,
  createBullLineData,
  BEAR_CONFIG,
  BULL_CONFIG,
} from '../utils/chartData'

export function useCycleComparisonData() {
  const [series, setSeries] = useState([])
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

  return { series, loading, error, maxDays }
}

export function useBearBoxData(cycleNumber = 4) {
  const [lineData, setLineData] = useState([])
  const [boxes, setBoxes] = useState([])
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
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [cycleNumber])

  return { lineData, boxes, loading, error, cycleInfo, config: BEAR_CONFIG }
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
        const data = await fetchCycleData(null, BULL_CONFIG.MIN_DAYS_FROM_PEAK)
        
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
