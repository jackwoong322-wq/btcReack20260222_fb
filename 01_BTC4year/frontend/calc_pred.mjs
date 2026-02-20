﻿import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

// .env 파일 읽기
const envContent = fs.readFileSync('.env', 'utf8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) return
  const key = trimmed.substring(0, eqIdx).trim()
  let val = trimmed.substring(eqIdx + 1).trim()
  const sq = String.fromCharCode(39)
  const dq = String.fromCharCode(34)
  if ((val.startsWith(sq) && val.endsWith(sq)) || (val.startsWith(dq) && val.endsWith(dq))) {
    val = val.slice(1, -1)
  }
  envVars[key] = val
})

const SUPABASE_URL = envVars['VITE_SUPABASE_URL']
const SUPABASE_KEY = envVars['VITE_SUPABASE_ANON_KEY']

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Supabase 환경변수 없음:', envVars)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const BEAR_CONFIG = {
  RISE_THRESHOLD: 5.0,
  BREAK_THRESHOLD: 2.0,
  MIN_DURATION_DAYS: 1,
  MAX_DURATION_DAYS: 420,
  MIN_DROP_FROM_PREV_HIGH: 3.0,
}

async function fetchData() {
  let allData = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('bitcoin_cycle_data')
      .select('cycle_number, days_since_peak, timestamp, close_rate, low_rate, high_rate')
      .lte('days_since_peak', 420)
      .order('days_since_peak', { ascending: true })
      .order('cycle_number', { ascending: true })
      .range(offset, offset + 999)
    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    allData = [...allData, ...data]
    if (data.length < 1000) break
    offset += 1000
  }
  return allData
}

function findTrueLow(cycleData, startIdx) {
  if (startIdx >= cycleData.length) return { low: null, idx: null }
  let minLow = cycleData[startIdx].lowRate, minLowIdx = startIdx
  for (let j = startIdx; j < cycleData.length; j++) {
    if (cycleData[j].lowRate < minLow) { minLow = cycleData[j].lowRate; minLowIdx = j }
    if (j > minLowIdx && cycleData[j].highRate - minLow >= BEAR_CONFIG.RISE_THRESHOLD)
      return { low: minLow, idx: minLowIdx }
  }
  return { low: null, idx: null }
}

function calculateBearBoxes(cycleData) {
  const filtered = cycleData.filter(d => d.day <= 420)
  if (filtered.length < 50) return []
  const boxes = []
  let boxId = 0, i = 1, prevBoxHigh = 100
  while (i < filtered.length) {
    const { low: localLow, idx: localLowIdx } = findTrueLow(filtered, i)
    if (localLow === null) break
    if (prevBoxHigh - localLow < BEAR_CONFIG.MIN_DROP_FROM_PREV_HIGH) { i = localLowIdx + 1; continue }
    let tempMax = localLow, tempMaxIdx = localLowIdx, achieved = false
    for (let j = localLowIdx + 1; j < filtered.length; j++) {
      if (filtered[j].highRate > tempMax) { tempMax = filtered[j].highRate; tempMaxIdx = j }
      if (tempMax - localLow >= BEAR_CONFIG.RISE_THRESHOLD) { achieved = true; break }
    }
    if (!achieved) { i = localLowIdx + 1; continue }
    const breakThreshold = localLow - localLow * BEAR_CONFIG.BREAK_THRESHOLD / 100
    const maxSearch = Math.min(filtered.length, localLowIdx + 420)
    let boxEndIdx = tempMaxIdx, boxBroken = false, maxHigh = tempMax, maxIdx = tempMaxIdx
    for (let k = tempMaxIdx + 1; k < maxSearch; k++) {
      if (filtered[k].lowRate <= breakThreshold) { boxEndIdx = k; boxBroken = true; break }
      if (filtered[k].highRate > maxHigh) { maxHigh = filtered[k].highRate; maxIdx = k }
      boxEndIdx = k
    }
    const dur = filtered[boxEndIdx].day - filtered[localLowIdx].day
    if (dur < 1) { i = boxEndIdx + 1; continue }
    boxId++
    boxes.push({
      Box_ID: boxId,
      Start_Day: filtered[localLowIdx].day,
      Start_Timestamp: filtered[localLowIdx].timestamp,
      Start_Rate: Math.round(localLow * 100) / 100,
      Peak_Day: filtered[maxIdx].day,
      Peak_Rate: Math.round(maxHigh * 100) / 100,
      End_Day: filtered[boxEndIdx].day,
      Duration_Days: dur,
    })
    prevBoxHigh = maxHigh
    i = boxEndIdx + 1
  }
  return boxes
}

function exponentialSmooth(values, alpha = 0.4) {
  const n = values.length
  if (n === 0) return { predicted: 0, sigma: 0 }
  if (n === 1) return { predicted: values[0], sigma: 0, normWeights: [1] }
  const weights = values.map((_, i) => alpha * Math.pow(1 - alpha, n - 1 - i))
  const weightSum = weights.reduce((s, w) => s + w, 0)
  const normWeights = weights.map(w => w / weightSum)
  const predicted = values.reduce((s, v, i) => s + v * normWeights[i], 0)
  const variance = values.reduce((s, v, i) => s + normWeights[i] * (v - predicted) ** 2, 0)
  return { predicted, sigma: Math.sqrt(variance), normWeights }
}

async function main() {
  console.log('데이터 로딩 중...')
  const raw = await fetchData()
  console.log(`총 ${raw.length}개 레코드`)

  // 사이클별 그룹
  const cycles = {}
  raw.forEach(r => {
    if (!cycles[r.cycle_number]) cycles[r.cycle_number] = []
    cycles[r.cycle_number].push({ day: r.days_since_peak, timestamp: r.timestamp, lowRate: r.low_rate, highRate: r.high_rate })
  })

  // Cycle 1~3 박스 계산
  const allBoxes = {}
  for (const cn of [1, 2, 3]) {
    allBoxes[cn] = calculateBearBoxes(cycles[cn] || [])
    console.log(`\nCycle ${cn} 박스 (${allBoxes[cn].length}개):`)
    allBoxes[cn].forEach((b, i) => {
      const prevPeak = i === 0 ? 100 : allBoxes[cn][i-1].Peak_Rate
      const drop = ((prevPeak - b.Start_Rate) / prevPeak * 100).toFixed(1)
      const rise = ((b.Peak_Rate - b.Start_Rate) / b.Start_Rate * 100).toFixed(1)
      console.log(`  Box${b.Box_ID}: L=${b.Start_Rate}% H=${b.Peak_Rate}% dur=${b.Duration_Days}d | drop=${drop}% rise=${rise}%`)
    })
  }

  // Cycle 4 박스
  const c4boxes = calculateBearBoxes(cycles[4] || [])
  console.log(`\nCycle 4 실제 박스 (${c4boxes.length}개):`)
  c4boxes.forEach((b, i) => {
    const prevPeak = i === 0 ? 100 : c4boxes[i-1].Peak_Rate
    const drop = ((prevPeak - b.Start_Rate) / prevPeak * 100).toFixed(1)
    const rise = ((b.Peak_Rate - b.Start_Rate) / b.Start_Rate * 100).toFixed(1)
    console.log(`  Box${b.Box_ID}: L=${b.Start_Rate}% H=${b.Peak_Rate}% dur=${b.Duration_Days}d | drop=${drop}% rise=${rise}%`)
  })

  // 박스별 통계
  console.log('\n\n=== 박스별 지수평활(α=0.4) 예측 ===')
  const statsByBoxNum = {}
  for (const cn of [1, 2, 3]) {
    allBoxes[cn].forEach((box, idx) => {
      const n = idx + 1
      if (!statsByBoxNum[n]) statsByBoxNum[n] = { drops: {}, rises: {}, durs: {} }
      const prevPeak = idx === 0 ? 100 : allBoxes[cn][idx-1].Peak_Rate
      statsByBoxNum[n].drops[cn] = (prevPeak - box.Start_Rate) / prevPeak * 100
      statsByBoxNum[n].rises[cn] = (box.Peak_Rate - box.Start_Rate) / box.Start_Rate * 100
      statsByBoxNum[n].durs[cn]  = box.Duration_Days
    })
  }

  const maxBox = Math.max(...Object.keys(statsByBoxNum).map(Number))
  for (let n = 1; n <= maxBox; n++) {
    const s = statsByBoxNum[n]
    if (!s) continue
    const dropVals = [1,2,3].map(cn => s.drops[cn]).filter(v => v !== undefined)
    const riseVals = [1,2,3].map(cn => s.rises[cn]).filter(v => v !== undefined)
    const durVals  = [1,2,3].map(cn => s.durs[cn]).filter(v => v !== undefined)
    const dr = exponentialSmooth(dropVals)
    const rr = exponentialSmooth(riseVals)
    const du = exponentialSmooth(durVals)
    console.log(`\nBox ${n}:`)
    console.log(`  dropRatio  C1=${dropVals[0]?.toFixed(1)} C2=${dropVals[1]?.toFixed(1)} C3=${dropVals[2]?.toFixed(1)} → ES예측=${dr.predicted.toFixed(1)}% ±${dr.sigma.toFixed(1)}%`)
    console.log(`  riseRatio  C1=${riseVals[0]?.toFixed(1)} C2=${riseVals[1]?.toFixed(1)} C3=${riseVals[2]?.toFixed(1)} → ES예측=${rr.predicted.toFixed(1)}% ±${rr.sigma.toFixed(1)}%`)
    console.log(`  duration   C1=${durVals[0]} C2=${durVals[1]} C3=${durVals[2]} → ES예측=${Math.round(du.predicted)}d`)
    console.log(`  가중치(정규화): C1=${(dr.normWeights[0]*100).toFixed(1)}% C2=${(dr.normWeights[1]*100).toFixed(1)}% C3=${(dr.normWeights[2]*100).toFixed(1)}%`)
  }
}

main().catch(console.error)
