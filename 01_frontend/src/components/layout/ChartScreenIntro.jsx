function ChartScreenIntro({ title }) {
  return (
    <div className="chart-shell-intro">
      <span className="chart-shell-kicker">Precision Cycle Monitor</span>
      <div className="chart-shell-head">
        <h1 className="chart-shell-title">{title}</h1>
        <p className="chart-shell-copy">
          데스크톱 중심의 차트 집중형 레이아웃으로 비트코인 사이클 흐름과 박스 구간을 빠르게 비교합니다.
        </p>
      </div>
    </div>
  )
}

export default ChartScreenIntro
