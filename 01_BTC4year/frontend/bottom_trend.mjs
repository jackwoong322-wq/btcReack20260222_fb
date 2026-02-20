import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envContent = fs.readFileSync('.env', 'utf8')
const envVars = {}
envContent.split('\n').forEach(line => {
  const [key, ...vals] = line.split('=')
  if (key && vals.length) envVars[key.trim()] = vals.join('=').trim().replace(/^['"]|['"]$/g, '')
})
const supabase = createClient(envVars['VITE_SUPABASE_URL'], envVars['VITE_SUPABASE_ANON_KEY'])

async function fetchData() {
  let allData = [], offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('bitcoin_cycle_data')
      .select('cycle_number, days_since_peak, low_rate, high_rate')
      .lte('days_since_peak', 420)
      .order('cycle_number', { ascending: true })
      .order('days_since_peak', { ascending: true })
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    allData = [...allData, ...data]
    if (data.length < 1000) break
    offset += 1000
  }
  return allData
}

async function main() {
  const raw = await fetchData()
  const cycles = {}
  raw.forEach(r => {
    if (!cycles[r.cycle_number]) cycles[r.cycle_number] = []
    cycles[r.cycle_number].push({ day: r.days_since_peak, low: r.low_rate, high: r.high_rate })
  })

  console.log('=== 사이클별 전체 최저점 (0~420일) ===')
  const bottoms = {}
  ;[1,2,3,4].forEach(cn => {
    const d = cycles[cn] || []
    const minLow = Math.min(...d.map(x => x.low))
    const minDay = d.find(x => x.low === minLow)?.day
    bottoms[cn] = minLow
    console.log(`Cycle ${cn}: 최저점 = ${minLow.toFixed(2)}% (Day ${minDay})`)
  })

  console.log('\n=== 사이클간 최저점 감소율 ===')
  console.log(`C1→C2: ${((bottoms[2]-bottoms[1])/bottoms[1]*100).toFixed(1)}% 변화 (${bottoms[1].toFixed(2)}→${bottoms[2].toFixed(2)})`)
  console.log(`C2→C3: ${((bottoms[3]-bottoms[2])/bottoms[2]*100).toFixed(1)}% 변화 (${bottoms[2].toFixed(2)}→${bottoms[3].toFixed(2)})`)
  console.log(`C3→C4 추세 연장 예측:`)
  
  // 선형 회귀로 C4 최저점 예측
  const xs = [1,2,3], ys = [bottoms[1], bottoms[2], bottoms[3]]
  const meanX = 2, meanY = ys.reduce((s,v)=>s+v,0)/3
  let ssXX=0, ssXY=0
  xs.forEach((x,i) => { ssXX+=(x-meanX)**2; ssXY+=(x-meanX)*(ys[i]-meanY) })
  const slope = ssXY/ssXX
  const intercept = meanY - slope*meanX
  const c4pred = slope*4 + intercept
  console.log(`  선형회귀: slope=${slope.toFixed(2)}, C4 예측 최저점 = ${c4pred.toFixed(2)}%`)

  // 변화율 평균으로도 계산
  const chg12 = bottoms[2]-bottoms[1]
  const chg23 = bottoms[3]-bottoms[2]
  const avgChg = (chg12+chg23)/2
  console.log(`  변화량 평균: ${avgChg.toFixed(2)}%p/사이클, C4 예측 = ${(bottoms[3]+avgChg).toFixed(2)}%`)

  // 변화율(%) 평균
  const pct12 = (bottoms[2]-bottoms[1])/bottoms[1]*100
  const pct23 = (bottoms[3]-bottoms[2])/bottoms[2]*100
  const avgPct = (pct12+pct23)/2
  console.log(`  변화율% 평균: ${avgPct.toFixed(1)}%/사이클, C4 예측 = ${(bottoms[3]*(1+avgPct/100)).toFixed(2)}%`)

  console.log('\n=== 사이클별 전체 최고점 감소율 (하락폭 비교) ===')
  ;[1,2,3,4].forEach(cn => {
    const d = cycles[cn] || []
    const maxHigh = d[0]?.high || 100  // Day0 = 100%
    const minLow = bottoms[cn]
    const drop = ((maxHigh - minLow) / maxHigh * 100)
    console.log(`Cycle ${cn}: 고점100% → 최저${minLow.toFixed(2)}% (하락폭 ${drop.toFixed(1)}%)`)
  })
}
main().catch(console.error)
