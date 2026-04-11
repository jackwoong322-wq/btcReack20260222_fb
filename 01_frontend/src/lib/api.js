/**
 * Backend API 클라이언트
 * 기존 supabase.js를 대체 — 모든 데이터를 Backend API를 통해 조회
 */

function formatApiDetail(detail) {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail)
  } catch {
    return String(detail)
  }
}

/**
 * API 베이스 URL
 * - `vite` 개발 모드(DEV)에서는 VITE_API_URL(Render 등)을 쓰지 않고 로컬 백엔드를 쓴다.
 *   (그렇지 않으면 메뉴가 원격 DB 기준으로 사이클 2개만 나오는 식으로 어긋난다.)
 * - 개발 중 원격 API만 쓰려면 .env 에 VITE_API_LOCAL_URL=https://...
 */
function resolveApiBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL
  if (import.meta.env.DEV) {
    return import.meta.env.VITE_API_LOCAL_URL || 'http://127.0.0.1:8000'
  }
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('vercel.app')) {
    return envUrl || 'https://btcreack20260222-fb.onrender.com'
  }
  return envUrl || 'http://127.0.0.1:8000'
}

let API_BASE_URL = resolveApiBaseUrl()

async function apiFetch(path, params = {}) {
  const url = new URL(`${API_BASE_URL}${path}`)
  Object.entries(params).forEach(([key, val]) => {
    if (val !== null && val !== undefined) {
      url.searchParams.set(key, val)
    }
  })

  const response = await fetch(url.toString())

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const msg = formatApiDetail(errorData.detail) || `API 오류: ${response.status}`
    throw new Error(msg)
  }

  return response.json()
}

// ─── API 함수들 ──────────────────────────────────────

/** 사이클 비교 차트 데이터 + 예측 */
export async function fetchCycleComparison() {
  return apiFetch('/api/cycle-comparison')
}

/** Bear 박스권 + 라인 데이터 + 예측 */
export async function fetchBearBoxes(cycleNumber = 4) {
  return apiFetch('/api/bear-boxes', { cycle: cycleNumber })
}

/** Bull 박스권 + 라인 데이터 */
export async function fetchBullBoxes(cycleNumber = 3) {
  return apiFetch('/api/bull-boxes', { cycle: cycleNumber })
}

/** Bear 예측만 별도 조회 */
export async function fetchBearPrediction(cycleNumber = 4) {
  return apiFetch('/api/bear-prediction', { cycle: cycleNumber })
}

/** OHLCV 데이터 (트레이딩 차트) */
export async function fetchOhlcvData() {
  return apiFetch('/api/ohlcv')
}

/** 설정값 조회 */
export async function fetchConfig() {
  return apiFetch('/api/config')
}

/** 사이드바 Bear/Bull 메뉴용 사이클 목록 (DB 기준) */
export async function fetchCycleMenu() {
  return apiFetch('/api/cycle-menu')
}
