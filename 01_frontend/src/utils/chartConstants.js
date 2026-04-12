export const COLORS = [
  '#d8a544',
  '#6f8fc7',
  '#90c5a4',
  '#cf7c62',
  '#8777c9',
  '#c98e56',
  '#5e9db4',
  '#b4bb74',
]

export const COLOR_NAMES = ['gold', 'steel', 'mint', 'coral', 'violet', 'amber', 'teal', 'olive']

export const CHART_THEME = {
  background: '#111722',
  panel: '#171e2b',
  panelSoft: '#141b27',
  text: '#edf2fb',
  textMuted: '#93a0b8',
  textSoft: '#6d778d',
  border: '#2a3444',
  grid: 'rgba(148, 163, 184, 0.12)',
  crosshair: '#c7d2e4',
  crosshairLabel: '#263244',
  accent: '#d8a544',
  accentSoft: '#7e6740',
  success: '#73b88d',
  danger: '#d17d68',
  info: '#6f8fc7',
}

export function formatDate(timestamp) {
  if (!timestamp) return ''
  try {
    const date = new Date(timestamp)
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  } catch {
    return String(timestamp).slice(0, 10).replace(/-/g, '.')
  }
}
