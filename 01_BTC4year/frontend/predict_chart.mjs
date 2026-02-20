import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envContent = fs.readFileSync('.env', 'utf8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=')
  if (key && vals.length) {
    let val = vals.join('=').trim()
    val = val.replace(/^['"]|['"]$/g, '')
    envVars[key.trim()] = val
  }
})

const supabase = createClient(envVars['VITE_SUPABASE_URL'], envVars['VITE_SUPABASE_ANON_KEY'])

const BEAR_CONFIG = {
  RISE_THRESHOLD: 5.0,
  BREAK_THRESHOLD: 2.0,
  MIN_DURATION_DAYS: 1,
  MAX_DURATION_DAYS: 420,
  MIN_DROP_FROM_PREV_HIGH: 3.0,
}

async function fetchData() {
  let allData = [], offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('bitcoin_cycle_data')
      .select('cycle_number, days_since_peak, timestamp, close_rate, low_rate, high_rate')
      .lte('days_since_peak', 420)
      .order('days_since_peak', { ascending: true })
      .order('cycle_number', { ascending: true })
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    allData = [...allData, ...data]
    if (data.length < 1000) break
    offset += 1000
  }
  return allData
}

function findTrueLow(data, startIdx) {
  let minLow = data[startIdx].lowRate, minIdx = startIdx
  for (let j = startIdx; j < data.length; j++) {
    if (data[j].lowRate < minLow) { minLow = data[j].lowRate; minIdx = j }
    if (j > minIdx && data[j].highRate - minLow >= BEAR_CONFIG.RISE_THRESHOLD)
      return { low: minLow, idx: minIdx }
  }
  return { low: null, idx: null }
}

function calcBoxes(cycleData) {
  const d = cycleData.filter(x => x.day <= 420)
  if (d.length < 50) return []
  const boxes = []; let id = 0, i = 1, prevHigh = 100
  while (i < d.length) {
    const { low, idx } = findTrueLow(d, i)
    if (low === null) break
    if (prevHigh - low < BEAR_CONFIG.MIN_DROP_FROM_PREV_HIGH) { i = idx + 1; continue }
    let tMax = low, tMaxIdx = idx, ok = false
    for (let j = idx + 1; j < d.length; j++) {
      if (d[j].highRate > tMax) { tMax = d[j].highRate; tMaxIdx = j }
      if (tMax - low >= BEAR_CONFIG.RISE_THRESHOLD) { ok = true; break }
    }
    if (!ok) { i = idx + 1; continue }
    const brk = low - low * BEAR_CONFIG.BREAK_THRESHOLD / 100
    let endIdx = tMaxIdx, broken = false, maxH = tMax, maxI = tMaxIdx
    for (let k = tMaxIdx + 1; k < Math.min(d.length, idx + 420); k++) {
      if (d[k].lowRate <= brk) { endIdx = k; broken = true; break }
      if (d[k].highRate > maxH) { maxH = d[k].highRate; maxI = k }
      endIdx = k
    }
    const dur = d[endIdx].day - d[idx].day
    if (dur < 1) { i = endIdx + 1; continue }
    id++
    boxes.push({
      id, startDay: d[idx].day, startRate: Math.round(low*100)/100,
      peakDay: d[maxI].day, peakRate: Math.round(maxH*100)/100,
      endDay: d[endIdx].day, dur
    })
    prevHigh = maxH; i = endIdx + 1
  }
  return boxes
}

function myPredict(allBoxes, c4boxes) {
  const c4Stats = c4boxes.map((b, i) => {
    const prevPeak = i === 0 ? 100 : c4boxes[i-1].peakRate
    return {
      drop: (prevPeak - b.startRate) / prevPeak * 100,
      rise: (b.peakRate - b.startRate) / b.startRate * 100,
      dur: b.dur
    }
  })

  console.log('\nCycle4 실제 통계:')
  c4Stats.forEach((s, i) => console.log(`  Box${i+1}: drop=${s.drop.toFixed(1)}% rise=${s.rise.toFixed(1)}% dur=${s.dur}d`))

  const c3 = allBoxes[3]
  const c3Stats = c3.map((b, i) => {
    const prevPeak = i === 0 ? 100 : c3[i-1].peakRate
    return {
      drop: (prevPeak - b.startRate) / prevPeak * 100,
      rise: (b.peakRate - b.startRate) / b.startRate * 100,
      dur: b.dur
    }
  })

  const scaleDrop = c4Stats.map((s, i) => c3Stats[i] ? s.drop / c3Stats[i].drop : 1)
  const avgScaleDrop = scaleDrop.reduce((a,b) => a+b, 0) / scaleDrop.length
  const scaleRise = c4Stats.map((s, i) => c3Stats[i] ? s.rise / c3Stats[i].rise : 1)
  const avgScaleRise = scaleRise.reduce((a,b) => a+b, 0) / scaleRise.length

  console.log(`\nCycle4/Cycle3 스케일: drop×${avgScaleDrop.toFixed(2)}, rise×${avgScaleRise.toFixed(2)}`)
  console.log('(1.0이면 동일, <1이면 Cycle4가 더 완만)')

  const startBoxNum = c4boxes.length + 1
  const predictions = []
  let prevPeak = c4boxes[c4boxes.length - 1].peakRate
  let currentDay = c4boxes[c4boxes.length - 1].endDay

  for (let n = startBoxNum; n <= c3.length; n++) {
    const c3s = c3Stats[n - 1]
    const predDrop = c3s.drop * avgScaleDrop
    const predRise = c3s.rise * avgScaleRise
    const predDur  = Math.round(c3s.dur * (c4Stats.map(s=>s.dur).reduce((a,b)=>a+b,0)/c4Stats.length) / (c3Stats.slice(0,c4boxes.length).map(s=>s.dur).reduce((a,b)=>a+b,0)/c4boxes.length))

    const startRate = Math.round(prevPeak * (1 - predDrop/100) * 100) / 100
    const peakRate  = Math.round(startRate * (1 + predRise/100) * 100) / 100

    predictions.push({
      boxNum: n,
      startDay: currentDay + 1,
      endDay: currentDay + 1 + predDur,
      peakDay: currentDay + 1 + Math.round(predDur / 2),
      startRate, peakRate, dur: predDur,
      predDrop: predDrop.toFixed(1), predRise: predRise.toFixed(1)
    })

    console.log(`\n예측 Box${n}: L=${startRate}% H=${peakRate}% dur=${predDur}d`)
    console.log(`  (C3 drop=${c3s.drop.toFixed(1)}%×${avgScaleDrop.toFixed(2)}=${predDrop.toFixed(1)}%, rise=${c3s.rise.toFixed(1)}%×${avgScaleRise.toFixed(2)}=${predRise.toFixed(1)}%)`)

    prevPeak = peakRate
    currentDay += predDur + 1
  }

  return predictions
}

async function main() {
  console.log('데이터 로딩 중...')
  const raw = await fetchData()
  console.log(`총 ${raw.length}건 로드`)

  const cycles = {}
  raw.forEach(r => {
    if (!cycles[r.cycle_number]) cycles[r.cycle_number] = []
    cycles[r.cycle_number].push({ day: r.days_since_peak, timestamp: r.timestamp, lowRate: r.low_rate, highRate: r.high_rate })
  })

  console.log('\n사이클별 데이터 수:')
  for (const cn of [1, 2, 3, 4]) {
    console.log(`  Cycle${cn}: ${(cycles[cn] || []).length}건`)
  }

  const allBoxes = {}
  for (const cn of [1, 2, 3, 4]) {
    allBoxes[cn] = calcBoxes(cycles[cn] || [])
    console.log(`  Cycle${cn} boxes: ${allBoxes[cn].length}개`)
  }

  console.log('\n=== 나의 예측 방식: Cycle3 패턴 × Cycle4 스케일 팩터 ===')
  const preds = myPredict(allBoxes, allBoxes[4])

  const result = {
    cycle4Real: allBoxes[4],
    predictions: preds,
    cycle3: allBoxes[3]
  }
  fs.writeFileSync('C:/MW/Source/01_BTC04_20260219/btcReack20260215BinanceChart/01_BTC4year/frontend/predict_result.json', JSON.stringify(result, null, 2))
  console.log('\n결과 저장: predict_result.json')
}

main().catch(console.error)
