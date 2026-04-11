/**
 * 차트 데이터 훅 (리팩토링 완료)
 *
 * [Before] Frontend → Supabase 직접 → 계산 → 렌더링
 * [After]  Frontend → Backend API → JSON → 렌더링
 *
 * 모든 계산 로직이 Backend로 이동되었으므로
 * 여기서는 순수하게 데이터 fetch + state 관리만 담당
 */
import { useState, useEffect } from 'react'
import {
  fetchCycleComparison,
  fetchBearBoxes,
  fetchBullBoxes,
  fetchBearPrediction,
} from '../lib/api'


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
        const result = await fetchCycleComparison()

        setSeries(result.series || [])
        setPredictions(result.predictions || [])
        setMaxDays(result.maxDays || 0)
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
  const [config, setConfig] = useState({})

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const result = await fetchBearBoxes(cycleNumber)

        setLineData(result.lineData || [])
        setBoxes(result.boxes || [])
        setPredictions(result.predictions || [])
        setCycleInfo(result.cycleInfo || { startDate: '', endDate: '' })
        setConfig(result.config || {})
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [cycleNumber])

  return { lineData, boxes, predictions, loading, error, cycleInfo, config }
}


export function useBearPrediction(cycleNumber = 4) {
  const [predictions, setPredictions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const result = await fetchBearPrediction(cycleNumber)
        setPredictions(result.predictions || [])
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
  const [config, setConfig] = useState({})

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const result = await fetchBullBoxes(cycleNumber)

        setLineData(result.lineData || [])
        setBoxes(result.boxes || [])
        setCycleInfo(result.cycleInfo || { startDate: '', endDate: '', maxDays: 0 })
        setConfig(result.config || {})
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [cycleNumber])

  return { lineData, boxes, loading, error, cycleInfo, config }
}
