import { supabase } from '../lib/supabase'

// ==================== 설정 ====================
export const CYCLE_TABLE_NAME = 'bitcoin_cycle_data'

// Bear (하락장) 설정
export const BEAR_CONFIG = {
  RISE_THRESHOLD: 5.0,
  BREAK_THRESHOLD: 2.0,
  MIN_DURATION_DAYS: 1,
  MAX_DURATION_DAYS: 400,   // Bear: 0 ~ 400일
  MIN_DROP_FROM_PREV_HIGH: 3.0,
}

// Bull (상승장) 설정
export const BULL_CONFIG = {
  MIN_DAYS_FROM_PEAK: 400,  // Bull: 400일 ~
  MAX_DAYS_FROM_PEAK: 1450, // Bull: ~ 1450일
  DROP_THRESHOLD: 5.0,
  BREAK_THRESHOLD: 2.0,
  MIN_DURATION_DAYS: 1,
  LOOKBACK_DAYS: 10,
}

// 차트 색상
export const COLORS = [
  '#3B82F6', '#10B981', '#EF4444', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
]

export const COLOR_NAMES = ['blue', 'green', 'red', 'orange', 'purple', 'pink', 'cyan', 'lime']

// ==================== 데이터 로딩 ====================

export async function fetchCycleData(maxDays = null, minDays = null) {
  let allData = []
  let offset = 0
  const batchSize = 1000
  
  while (true) {
    let query = supabase
      .from(CYCLE_TABLE_NAME)
      .select('cycle_number, days_since_peak, timestamp, close_rate, low_rate, high_rate')
      .order('days_since_peak', { ascending: true })
      .order('cycle_number', { ascending: true })
      .range(offset, offset + batchSize - 1)

    if (maxDays !== null) {
      query = query.lte('days_since_peak', maxDays)
    }
    if (minDays !== null) {
      query = query.gte('days_since_peak', minDays)
    }

    const { data, error } = await query

    if (error) {
      console.error('데이터 로드 오류:', error)
      return null
    }

    if (!data || data.length === 0) break

    allData = [...allData, ...data]
    
    if (data.length < batchSize) break
    offset += batchSize
  }

  return allData
}

export function groupByCycle(data) {
  const cycles = {}
  
  data.forEach(row => {
    const cycleNum = row.cycle_number
    if (!cycles[cycleNum]) {
      cycles[cycleNum] = []
    }
    cycles[cycleNum].push({
      day: row.days_since_peak,
      timestamp: row.timestamp,
      closeRate: row.close_rate,
      lowRate: row.low_rate,
      highRate: row.high_rate,
    })
  })

  return cycles
}

// ==================== 사이클 비교 차트용 ====================

export function createCycleComparisonSeries(cycles) {
  const series = []

  Object.keys(cycles).sort((a, b) => Number(a) - Number(b)).forEach((cycleNum, idx) => {
    const cycleData = cycles[cycleNum]
    if (cycleData.length === 0) return

    const startDate = formatDate(cycleData[0].timestamp)
    const endDate = formatDate(cycleData[cycleData.length - 1].timestamp)
    const minRate = Math.min(...cycleData.map(d => d.closeRate))

    series.push({
      name: `Cycle ${cycleNum} : ${startDate}`,
      data: cycleData.map(d => ({ x: d.day, y: Math.round(d.closeRate * 100) / 100 })),
      startDate,
      endDate,
      dayCount: cycleData.length,
      minRate: Math.round(minRate * 100) / 100,
      color: COLORS[idx % COLORS.length],
      colorName: COLOR_NAMES[idx % COLOR_NAMES.length],
    })
  })

  return series
}

// ==================== Bear 박스권 계산 ====================

function findTrueLowBeforeRise(cycleData, startIdx, config) {
  if (startIdx >= cycleData.length) return { low: null, idx: null }

  let minLow = cycleData[startIdx].lowRate
  let minLowIdx = startIdx

  for (let j = startIdx; j < cycleData.length; j++) {
    const currentLow = cycleData[j].lowRate
    const currentHigh = cycleData[j].highRate

    if (currentLow < minLow) {
      minLow = currentLow
      minLowIdx = j
    }

    if (j > minLowIdx && currentHigh - minLow >= config.RISE_THRESHOLD) {
      return { low: minLow, idx: minLowIdx }
    }
  }

  return { low: null, idx: null }
}

function findRisePeak(cycleData, startIdx, localLow, config) {
  let tempMax = localLow
  let tempMaxIdx = startIdx

  for (let j = startIdx + 1; j < cycleData.length; j++) {
    const currentHigh = cycleData[j].highRate
    if (currentHigh > tempMax) {
      tempMax = currentHigh
      tempMaxIdx = j
    }
    if (tempMax - localLow >= config.RISE_THRESHOLD) {
      return { achieved: true, max: tempMax, idx: tempMaxIdx }
    }
  }

  return { achieved: false, max: tempMax, idx: tempMaxIdx }
}

function findBearBoxEnd(cycleData, localLowIdx, localLow, startSearchIdx, tempMax, tempMaxIdx, config) {
  const breakThreshold = localLow - (localLow * config.BREAK_THRESHOLD / 100)
  const maxSearchIdx = Math.min(cycleData.length, localLowIdx + config.MAX_DURATION_DAYS)

  let boxEndIdx = startSearchIdx
  let boxBroken = false
  let maxHigh = tempMax
  let maxIdx = tempMaxIdx

  for (let k = startSearchIdx + 1; k < maxSearchIdx; k++) {
    const checkLow = cycleData[k].lowRate
    const currentHigh = cycleData[k].highRate

    if (checkLow <= breakThreshold) {
      boxEndIdx = k
      boxBroken = true
      break
    }

    if (currentHigh > maxHigh) {
      maxHigh = currentHigh
      maxIdx = k
    }
    boxEndIdx = k
  }

  if (!boxBroken && boxEndIdx >= maxSearchIdx - 1) {
    boxBroken = true
  }

  return { boxEndIdx, boxBroken, maxHigh, maxIdx }
}

export function calculateBearBoxes(cycleData, cycleNum, config = BEAR_CONFIG) {
  const filteredData = cycleData.filter(d => d.day <= config.MAX_DURATION_DAYS)
  if (filteredData.length < 50) return []

  const boxes = []
  let boxId = 0
  let i = 1
  let prevBoxHigh = 100

  while (i < filteredData.length) {
    const { low: localLow, idx: localLowIdx } = findTrueLowBeforeRise(filteredData, i, config)
    if (localLow === null) break

    const dropFromPrevHigh = prevBoxHigh - localLow
    if (dropFromPrevHigh < config.MIN_DROP_FROM_PREV_HIGH) {
      i = localLowIdx + 1
      continue
    }

    const { achieved, max: tempMax, idx: tempMaxIdx } = findRisePeak(filteredData, localLowIdx, localLow, config)
    if (!achieved) {
      i = localLowIdx + 1
      continue
    }

    let { boxEndIdx, boxBroken, maxHigh, maxIdx } = findBearBoxEnd(
      filteredData, localLowIdx, localLow, tempMaxIdx, tempMax, tempMaxIdx, config
    )

    if (maxIdx > boxEndIdx) {
      const sliced = filteredData.slice(localLowIdx, boxEndIdx + 1)
      maxHigh = Math.max(...sliced.map(d => d.highRate))
      maxIdx = localLowIdx + sliced.findIndex(d => d.highRate === maxHigh)
    }

    const boxDuration = filteredData[boxEndIdx].day - filteredData[localLowIdx].day
    if (boxDuration < config.MIN_DURATION_DAYS) {
      i = boxEndIdx + 1
      continue
    }

    boxId++
    boxes.push({
      Cycle: cycleNum,
      Box_ID: boxId,
      Start_Day: filteredData[localLowIdx].day,
      Start_Timestamp: filteredData[localLowIdx].timestamp,
      Start_Rate: Math.round(localLow * 100) / 100,
      Peak_Day: filteredData[maxIdx].day,
      Peak_Timestamp: filteredData[maxIdx].timestamp,
      Peak_Rate: Math.round(maxHigh * 100) / 100,
      End_Day: filteredData[boxEndIdx].day,
      End_Timestamp: filteredData[boxEndIdx].timestamp,
      End_Rate: Math.round(filteredData[boxEndIdx].lowRate * 100) / 100,
      Rise_Percent: Math.round((maxHigh - localLow) * 100) / 100,
      Duration_Days: boxDuration,
      Box_Broken: boxBroken,
      color: COLORS[(boxId - 1) % COLORS.length],
    })

    prevBoxHigh = maxHigh
    i = boxEndIdx + 1
  }

  return boxes
}

// ==================== Bull 박스권 계산 ====================

function isSignificantHigh(cycleData, idx, lookback) {
  if (idx < lookback) return false

  const current = cycleData[idx].highRate
  const start = Math.max(0, idx - lookback)
  const end = Math.min(cycleData.length, idx + lookback + 1)

  const rangeMax = Math.max(...cycleData.slice(start, end).map(d => d.highRate))
  return current >= rangeMax
}

function findDropLow(cycleData, startIdx, localHigh, config) {
  let tempMin = localHigh
  let tempMinIdx = startIdx

  for (let j = startIdx + 1; j < cycleData.length; j++) {
    const currentLow = cycleData[j].lowRate
    if (currentLow < tempMin) {
      tempMin = currentLow
      tempMinIdx = j
    }
    if (localHigh - tempMin >= config.DROP_THRESHOLD) {
      return { achieved: true, min: tempMin, idx: tempMinIdx }
    }
  }

  return { achieved: false, min: tempMin, idx: tempMinIdx }
}

function findBullBoxEnd(cycleData, localHighIdx, localHigh, startSearchIdx, tempMin, tempMinIdx, config) {
  const breakThreshold = localHigh + (localHigh * config.BREAK_THRESHOLD / 100)

  let boxEndIdx = startSearchIdx
  let boxBroken = false
  let minLow = tempMin
  let minIdx = tempMinIdx

  for (let k = startSearchIdx + 1; k < cycleData.length; k++) {
    const checkHigh = cycleData[k].highRate
    const currentLow = cycleData[k].lowRate

    if (checkHigh >= breakThreshold) {
      boxEndIdx = k
      boxBroken = true
      break
    }

    if (currentLow < minLow) {
      minLow = currentLow
      minIdx = k
    }
    boxEndIdx = k
  }

  if (!boxBroken) {
    boxEndIdx = cycleData.length - 1
    boxBroken = true
  }

  return { boxEndIdx, boxBroken, minLow, minIdx }
}

export function calculateBullBoxes(cycleData, cycleNum, config = BULL_CONFIG) {
  const filteredData = cycleData.filter(d =>
    d.day >= config.MIN_DAYS_FROM_PEAK &&
    d.day <= (config.MAX_DAYS_FROM_PEAK ?? Infinity)
  )
  if (filteredData.length < 20) return []

  const boxes = []
  let boxId = 0
  let i = config.LOOKBACK_DAYS

  while (i < filteredData.length) {
    if (!isSignificantHigh(filteredData, i, config.LOOKBACK_DAYS)) {
      i++
      continue
    }

    const localHigh = filteredData[i].highRate
    const localHighIdx = i

    const { achieved, min: tempMin, idx: tempMinIdx } = findDropLow(filteredData, i, localHigh, config)
    if (!achieved) {
      i++
      continue
    }

    let { boxEndIdx, boxBroken, minLow, minIdx } = findBullBoxEnd(
      filteredData, localHighIdx, localHigh, tempMinIdx, tempMin, tempMinIdx, config
    )

    if (minIdx > boxEndIdx) {
      const sliced = filteredData.slice(localHighIdx, boxEndIdx + 1)
      minLow = Math.min(...sliced.map(d => d.lowRate))
      minIdx = localHighIdx + sliced.findIndex(d => d.lowRate === minLow)
    }

    const boxDuration = filteredData[boxEndIdx].day - filteredData[localHighIdx].day
    if (boxDuration < config.MIN_DURATION_DAYS) {
      i = boxEndIdx + 1
      continue
    }

    boxId++
    boxes.push({
      Cycle: cycleNum,
      Box_ID: boxId,
      Start_Day: filteredData[localHighIdx].day,
      Start_Timestamp: filteredData[localHighIdx].timestamp,
      Start_Rate: Math.round(localHigh * 100) / 100,
      Low_Day: filteredData[minIdx].day,
      Low_Timestamp: filteredData[minIdx].timestamp,
      Low_Rate: Math.round(minLow * 100) / 100,
      End_Day: filteredData[boxEndIdx].day,
      End_Timestamp: filteredData[boxEndIdx].timestamp,
      End_Rate: Math.round(filteredData[boxEndIdx].highRate * 100) / 100,
      Drop_Percent: Math.round((localHigh - minLow) * 100) / 100,
      Duration_Days: boxDuration,
      Box_Broken: boxBroken,
      color: COLORS[(boxId - 1) % COLORS.length],
    })

    i = boxEndIdx + 1
  }

  return boxes
}

// ==================== Bear 예측 ====================

/**
 * 지수 평활 (Exponential Smoothing, α=0.4)
 * values = [cycle1값, cycle2값, cycle3값] — 오래된 것부터 순서대로
 *
 * 가중치: C3=41%, C2=35%, C1=26%  (최근 중심이지만 과거도 충분히 반영)
 * σ: 각 값과 가중평균의 차이로 불확실성 범위 계산
 *
 * α=0.4: 완만한 가중 (0에 가까울수록 과거 중심, 1에 가까울수록 최근 중심)
 */
function exponentialSmooth(values, alpha = 0.4) {
  const n = values.length
  if (n === 0) return { predicted: 0, sigma: 0 }
  if (n === 1) return { predicted: values[0], sigma: 0 }

  // 가중치 계산: 최신(마지막)에 α, 그 전에 α(1-α), ...
  // values[0]=C1(오래됨), values[n-1]=C3(최신)
  const weights = values.map((_, i) => {
    const distFromLatest = n - 1 - i   // 0=최신, 1=그다음, ...
    return alpha * Math.pow(1 - alpha, distFromLatest)
  })
  const weightSum = weights.reduce((s, w) => s + w, 0)
  const normWeights = weights.map(w => w / weightSum)  // 정규화

  // 가중 평균 = 예측값
  const predicted = values.reduce((s, v, i) => s + v * normWeights[i], 0)

  // 가중 표준편차 (σ)
  const variance = values.reduce((s, v, i) => s + normWeights[i] * (v - predicted) ** 2, 0)
  const sigma    = Math.sqrt(variance)

  return { predicted, sigma }
}

/**
 * 가장 유사한 사이클 찾기:
 * Cycle 4의 실제 박스(n개)와 Cycle 1~3의 첫 n개 박스 패턴을 비교
 * dropRatio / riseRatio의 MSE(평균제곱오차)가 가장 작은 사이클 반환
 */
function findMostSimilarCycle(allCycleBoxes, cycle4Boxes) {
  if (cycle4Boxes.length === 0) return { cycleNum: 3, mse: Infinity }

  const n = cycle4Boxes.length

  // Cycle 4 실제 비율
  const c4Drops = cycle4Boxes.map((box, idx) => {
    const prevPeak = idx === 0 ? 100 : cycle4Boxes[idx - 1].Peak_Rate
    return (prevPeak - box.Start_Rate) / prevPeak * 100
  })
  const c4Rises = cycle4Boxes.map((box) =>
    (box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100
  )

  let bestCycle = 3
  let bestMSE   = Infinity

  ;[1, 2, 3].forEach(cn => {
    const boxes = allCycleBoxes[cn] || []
    if (boxes.length < n) return

    let mse = 0
    for (let i = 0; i < n; i++) {
      const prevPeak = i === 0 ? 100 : boxes[i - 1].Peak_Rate
      const drop = (prevPeak - boxes[i].Start_Rate) / prevPeak * 100
      const rise = (boxes[i].Peak_Rate - boxes[i].Start_Rate) / boxes[i].Start_Rate * 100
      mse += (drop - c4Drops[i]) ** 2 + (rise - c4Rises[i]) ** 2
    }
    mse /= n

    if (mse < bestMSE) {
      bestMSE   = mse
      bestCycle = cn
    }
  })

  return { cycleNum: bestCycle, mse: bestMSE }
}

/**
 * Cycle 1~3의 박스 패턴을 분석하여 Cycle 4 예측 박스를 생성
 *
 * 방법 1: 지수 평활 α=0.7 (C3=70%, C2=21%, C1=6.3% 가중 → 최근 사이클 중심)
 * 방법 2: ±1σ 밴드 (예측 불확실성 범위)
 * 방법 3: 가장 유사한 사이클 표시
 *
 * @param {Object} allCycleBoxes  - { 1: [...], 2: [...], 3: [...] }
 * @param {Array}  cycle4Boxes    - Cycle 4 실제 박스 배열
 * @param {Array}  cycle4Data     - Cycle 4 lineData (타임스탬프 참조용)
 * @returns {Array} 예측 박스 배열 (회귀 예측 + 상·하단 밴드 포함)
 */
export function calculateBearPrediction(allCycleBoxes, cycle4Boxes, cycle4Data) {
  const refCycles = [1, 2, 3]

  // ── 박스 번호별 사이클별 상대 변화율 수집 ──────────────────────
  const statsByBoxNum = {}
  refCycles.forEach(cn => {
    const boxes = allCycleBoxes[cn] || []
    boxes.forEach((box, idx) => {
      const n = idx + 1
      if (!statsByBoxNum[n]) {
        statsByBoxNum[n] = { dropByCycle: {}, riseByCycle: {}, durByCycle: {} }
      }
      const prevPeak = idx === 0 ? 100 : boxes[idx - 1].Peak_Rate
      statsByBoxNum[n].dropByCycle[cn] = (prevPeak - box.Start_Rate) / prevPeak * 100
      statsByBoxNum[n].riseByCycle[cn] = (box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100
      statsByBoxNum[n].durByCycle[cn]  = box.Duration_Days
    })
  })

  // ── [개선①] 박스 수 자체를 ES로 예측 ──────────────────────────
  // C1~C3 각각의 총 박스 수에 ES 적용 → C4 예상 총 박스 수 계산
  const boxCounts = refCycles.map(cn => (allCycleBoxes[cn] || []).length)
  const boxCountES = exponentialSmooth(boxCounts)
  // 예측 총 박스 수: ES 예측값을 반올림, 최소 현재 C4 박스+1 보장
  const predictedTotalBoxes = Math.max(
    cycle4Boxes.length + 1,
    Math.round(boxCountES.predicted)
  )

  // ── [개선②] 유사 사이클을 예측 가중치에 실제 반영 ─────────────
  // findMostSimilarCycle 결과를 ES alpha 조정에 활용
  // 유사 사이클이 C3이면 alpha를 높여(최신 중심), C1이면 낮춤(균등)
  const { cycleNum: similarCycle, mse: similarMSE } = findMostSimilarCycle(allCycleBoxes, cycle4Boxes)
  // 유사 사이클 번호 → 가중치 조정: C3=0.55, C2=0.40, C1=0.28
  const similarAlphaMap = { 1: 0.28, 2: 0.40, 3: 0.55 }
  const adjustedAlpha = similarAlphaMap[similarCycle] ?? 0.4

  // ── C4 예측의 "절대 기준점" 계산 (개선③ 오차 누적 방지용) ─────
  // 현재 C4의 마지막 실제 박스가 전체 100% 중 어디쯤인지 파악
  // 각 박스를 전체 하락 진행률(절대값) 기준으로 독립 예측하기 위한 앵커
  const lastRealBox = cycle4Boxes[cycle4Boxes.length - 1]
  if (!lastRealBox) return []

  // C4 현재 진행률: 마지막 실제 저점을 기준으로 이후 박스를 절대값으로 예측
  // C1~C3에서 동일 박스 번호의 실제 저점 절대값 평균을 구해 앵커로 사용
  const absBaseByBoxNum = {}
  refCycles.forEach(cn => {
    const boxes = allCycleBoxes[cn] || []
    boxes.forEach((box, idx) => {
      const n = idx + 1
      if (!absBaseByBoxNum[n]) absBaseByBoxNum[n] = []
      absBaseByBoxNum[n].push(box.Start_Rate)  // 전고점 대비 절대 %값
    })
  })

  const predictions   = []
  let currentDay      = lastRealBox.End_Day
  let currentDate     = new Date(lastRealBox.End_Timestamp)

  // [개선③] 누적 오차 방지: prevPeakRate를 예측값이 아닌
  // 절대 앵커 기반으로 매 박스마다 독립적으로 재계산
  // → 앞 박스 오차가 뒤 박스로 전파되지 않도록 함
  // 단, 앵커 데이터가 없는 박스는 연쇄 방식으로 fallback
  let prevPeakRate_chain    = lastRealBox.Peak_Rate
  let prevPeakRateHi_chain  = lastRealBox.Peak_Rate
  let prevPeakRateLo_chain  = lastRealBox.Peak_Rate

  const startBoxNum = cycle4Boxes.length + 1

  // [개선①] maxBoxNum을 고정 최대값이 아닌 ES 예측값으로 사용
  const maxBoxNum = predictedTotalBoxes

  for (let n = startBoxNum; n <= 99; n++) {  // 400일 될 때까지 계속 생성
    const stats = statsByBoxNum[n]
    if (!stats) break

    const dropVals = refCycles.map(cn => stats.dropByCycle[cn]).filter(v => v !== undefined)
    const riseVals = refCycles.map(cn => stats.riseByCycle[cn]).filter(v => v !== undefined)
    const durVals  = refCycles.map(cn => stats.durByCycle[cn]).filter(v => v !== undefined)
    if (dropVals.length === 0) break

    // [개선②] 유사 사이클 기반 adjustedAlpha 적용
    const dropReg = exponentialSmooth(dropVals, adjustedAlpha)
    const riseReg = exponentialSmooth(riseVals, adjustedAlpha)
    const durReg  = exponentialSmooth(durVals,  adjustedAlpha)

    const predDropRatio = Math.max(0, dropReg.predicted)
    const predRiseRatio = Math.max(0, riseReg.predicted)
    const predDuration  = Math.max(5, Math.round(durReg.predicted))

    // ±1σ 밴드
    const dropLo = Math.max(0,  predDropRatio - dropReg.sigma)
    const dropHi = Math.min(99, predDropRatio + dropReg.sigma)
    const riseLo = Math.max(0,  predRiseRatio - riseReg.sigma)
    const riseHi = predRiseRatio + riseReg.sigma

    // [개선③] 독립 앵커 계산: 해당 박스 번호의 C1~C3 절대 저점들을 ES로 예측
    // 이 값이 있으면 체인 방식 대신 절대 앵커 기준으로 Start_Rate 독립 산출
    let predStartRate, predPeakRate
    const absVals = absBaseByBoxNum[n] || []

    if (absVals.length >= 2) {
      // 절대 앵커 방식: C1~C3의 해당 박스 저점 절대값을 직접 ES 예측
      const absES = exponentialSmooth(absVals, adjustedAlpha)
      predStartRate = Math.round(Math.max(0, absES.predicted) * 100) / 100
      predPeakRate  = Math.round(predStartRate * (1 + predRiseRatio / 100) * 100) / 100
    } else {
      // 앵커 데이터 부족 시 체인 방식 fallback
      predStartRate = Math.round(prevPeakRate_chain * (1 - predDropRatio / 100) * 100) / 100
      predPeakRate  = Math.round(predStartRate * (1 + predRiseRatio / 100) * 100) / 100
    }

    // [개선④] 클램핑: 중앙/낙관/비관 밴드 모두에 일관 적용
    // C4 예측 최저점 범위: 30%(낙관 하한) ~ 35%(비관 하한)
    const CLAMP_CENTER_MIN = 30.0  // 중앙 예측 하한
    const CLAMP_HI_MIN     = 35.0  // 낙관 밴드 하한 (낙관이므로 더 높게)
    const CLAMP_LO_MIN     = 28.0  // 비관 밴드 하한 (비관이므로 더 낮게 허용)

    const clampedStartRate = Math.max(predStartRate, CLAMP_CENTER_MIN)

    // 낙관 밴드 (하락 적게 → Start_Rate 높아야 낙관)
    const predStartHi_raw = Math.round(prevPeakRateHi_chain * (1 - dropLo / 100) * 100) / 100
    const predPeakHi      = Math.round(predStartHi_raw * (1 + riseHi / 100) * 100) / 100
    const predStartHi     = Math.max(predStartHi_raw, CLAMP_HI_MIN)

    // 비관 밴드 (하락 많이 → Start_Rate 낮아야 비관, 단 하한은 CLAMP_LO_MIN)
    const predStartLo_raw = Math.round(prevPeakRateLo_chain * (1 - dropHi / 100) * 100) / 100
    const predPeakLo      = Math.round(predStartLo_raw * (1 + riseLo / 100) * 100) / 100
    const predStartLo     = Math.max(predStartLo_raw, CLAMP_LO_MIN)

    const boxStartDate = new Date(currentDate)
    boxStartDate.setDate(boxStartDate.getDate() + 1)

    const boxStartDay = currentDay + 1
    const rawEndDay   = boxStartDay + predDuration
    const clampedEndDay = Math.min(rawEndDay, BEAR_CONFIG.MAX_DURATION_DAYS)
    const clampedDuration = clampedEndDay - boxStartDay

    const boxEndDate = new Date(boxStartDate)
    boxEndDate.setDate(boxEndDate.getDate() + clampedDuration)

    const boxPeakDate = new Date(boxStartDate)
    boxPeakDate.setDate(boxPeakDate.getDate() + Math.round(clampedDuration / 2))

    predictions.push({
      Box_ID:   n,
      isPrediction: true,
      similarCycle,
      adjustedAlpha,   // 디버그용: 실제 사용된 alpha

      Start_Timestamp: boxStartDate.toISOString(),
      Start_Rate:      clampedStartRate,
      Peak_Timestamp:  boxPeakDate.toISOString(),
      Peak_Rate:       predPeakRate,
      End_Timestamp:   boxEndDate.toISOString(),
      Duration_Days:   clampedDuration,

      Start_Rate_Hi: predStartHi,
      Peak_Rate_Hi:  predPeakHi,
      Start_Rate_Lo: predStartLo,
      Peak_Rate_Lo:  predPeakLo,

      refCycles,
    })

    // 체인 방식 fallback용 이전 피크 업데이트 (독립 앵커 방식에서도 다음 박스 참조용으로 유지)
    prevPeakRate_chain    = predPeakRate
    prevPeakRateHi_chain  = predPeakHi
    prevPeakRateLo_chain  = predPeakLo
    currentDay    += clampedDuration + 1
    currentDate    = new Date(boxEndDate)

    if (currentDay >= BEAR_CONFIG.MAX_DURATION_DAYS) break
  }

  return predictions
}

// ==================== 유틸리티 ====================

export function formatDate(timestamp) {
  if (!timestamp) return ''
  try {
    const date = new Date(timestamp)
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  } catch {
    return String(timestamp).slice(0, 10).replace(/-/g, '.')
  }
}

export function createBearLineData(cycleData, boxes) {
  return cycleData
    .filter(d => d.day <= BEAR_CONFIG.MAX_DURATION_DAYS)
    .map(d => {
      const currentBox = boxes.find(box => box.Start_Day <= d.day && d.day <= box.End_Day)
      const boxDay = currentBox ? d.day - currentBox.Start_Day + 1 : null

      let prevHigh = 100
      for (const box of boxes) {
        if (box.Peak_Day < d.day) {
          prevHigh = box.Peak_Rate
        }
      }

      return {
        day: d.day,
        timestamp: d.timestamp, // 원본 타임스탬프 유지
        timestampFormatted: formatDate(d.timestamp),
        value: Math.round(d.lowRate * 100) / 100,
        box_id: currentBox?.Box_ID || null,
        box_day: boxDay,
        box_duration: currentBox?.Duration_Days || null,
        box_low: currentBox?.Start_Rate || null,
        box_high: currentBox?.Peak_Rate || null,
        prev_high: prevHigh,
      }
    })
}

export function createBullLineData(cycleData, boxes) {
  return cycleData
    .filter(d => d.day >= BULL_CONFIG.MIN_DAYS_FROM_PEAK && d.day <= BULL_CONFIG.MAX_DAYS_FROM_PEAK)
    .map(d => {
      const currentBox = boxes.find(box => box.Start_Day <= d.day && d.day <= box.End_Day)
      const boxDay = currentBox ? d.day - currentBox.Start_Day + 1 : null

      let prevLow = cycleData[0]?.highRate || 100
      for (const box of boxes) {
        if (box.Low_Day < d.day) {
          prevLow = box.Low_Rate
        }
      }

      return {
        day: d.day,
        timestamp: d.timestamp, // 원본 타임스탬프 유지
        timestampFormatted: formatDate(d.timestamp),
        value: Math.round(d.highRate * 100) / 100,
        box_id: currentBox?.Box_ID || null,
        box_day: boxDay,
        box_duration: currentBox?.Duration_Days || null,
        box_high: currentBox?.Start_Rate || null,
        box_low: currentBox?.Low_Rate || null,
        prev_low: prevLow,
      }
    })
}
