/*
 * Chart data hooks
 *
 * All data shaping and heavy calculation are handled by the backend.
 * These hooks are responsible only for fetching API responses and
 * exposing stable loading, error, and data state to the UI.
 */
import { useState, useEffect } from 'react'
import {
  fetchCycleComparison,
  fetchBearBoxes,
  fetchBullBoxes,
} from '../lib/api'

export function useCycleComparisonData() {
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const result = await fetchCycleComparison()
        setSeries(result.series || [])
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  return { series, loading, error }
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
