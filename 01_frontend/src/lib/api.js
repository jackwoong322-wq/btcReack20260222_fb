/*
 * Backend API client
 *
 * The frontend reads all chart data through the backend API rather than
 * talking directly to Supabase from the browser.
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

/*
 * API base URL rules
 * - In local Vite dev, prefer `VITE_API_LOCAL_URL` and fall back to the
 *   local backend server.
 * - In deployed frontend environments, prefer `VITE_API_URL`.
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
    const msg = formatApiDetail(errorData.detail) || `API error: ${response.status}`
    throw new Error(msg)
  }

  return response.json()
}

/* Cycle comparison chart data */
export async function fetchCycleComparison() {
  return apiFetch('/api/cycle-comparison')
}

/* Bear box data and predictions */
export async function fetchBearBoxes(cycleNumber = 4) {
  return apiFetch('/api/bear-boxes', { cycle: cycleNumber })
}

/* Bull box data */
export async function fetchBullBoxes(cycleNumber = 3) {
  return apiFetch('/api/bull-boxes', { cycle: cycleNumber })
}

/* OHLCV data for the trading chart */
export async function fetchOhlcvData() {
  return apiFetch('/api/ohlcv')
}

/* Sidebar cycle list for Bear/Bull navigation */
export async function fetchCycleMenu() {
  return apiFetch('/api/cycle-menu')
}
