import '../styles/Chart.css'

export function ChartLoadingState({ title, message }) {
  return (
    <div className="loading-container" role="status" aria-live="polite">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  )
}

export function ChartErrorState({ title, message }) {
  return (
    <div className="error-container" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  )
}
