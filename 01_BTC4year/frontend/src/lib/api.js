/**
 * Backend API 클라이언트
 * 기존 supabase.js를 대체 — 모든 데이터를 Backend API를 통해 조회
 */

// 환경변수 + 실행 환경에 따라 API URL 결정
let API_BASE_URL = import.meta.env.VITE_API_URL

// Vercel 프로덕션(프론트)에서 환경변수가 없다면 Render 백엔드로 기본 지정
if (!API_BASE_URL && typeof window !== 'undefined') {
  if (window.location.hostname.endsWith('vercel.app')) {
    // Render Web Service 도메인으로 교체
    API_BASE_URL = 'https://btcreack20260222-fb.onrender.com'
  } else {
    // 로컬 개발 기본값
    API_BASE_URL = 'http://localhost:8000'
  }
}

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
    throw new Error(errorData.detail || `API 오류: ${response.status}`)
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
