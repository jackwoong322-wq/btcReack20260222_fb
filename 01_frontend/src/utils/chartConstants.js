/**
 * 차트 UI 상수 (Frontend 전용)
 * 비즈니스 로직과 무관한 UI 표시용 상수
 */

export const COLORS = [
  '#3B82F6', '#10B981', '#EF4444', '#F59E0B',
  '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'
]

export const COLOR_NAMES = ['blue', 'green', 'red', 'orange', 'purple', 'pink', 'cyan', 'lime']

/** 타임스탬프 → YYYY.MM.DD 포맷 */
export function formatDate(timestamp) {
  if (!timestamp) return ''
  try {
    const date = new Date(timestamp)
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  } catch {
    return String(timestamp).slice(0, 10).replace(/-/g, '.')
  }
}
