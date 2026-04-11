import { useEffect, useRef } from 'react'

/**
 * lightweight-charts 차트를 컨테이너 크기에 맞게 자동 반응형으로 만드는 훅.
 * ResizeObserver 기반 → window.resize 보다 정확하고 빠름.
 *
 * @param {React.RefObject} containerRef - 차트가 마운트된 div의 ref
 * @param {React.RefObject[]} chartRefs  - applyOptions({ width, height })를 지원하는 차트 인스턴스 ref 배열
 * @param {{ watchHeight?: boolean }} options
 */
export function useResizeChart(containerRef, chartRefs, options = {}) {
  const { watchHeight = false, layoutKey = 0 } = options
  const observerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    const applySize = (entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width === 0) return

        chartRefs.forEach(ref => {
          const chart = ref.current
          if (!chart) return
          const opts = { width: Math.floor(width) }
          if (watchHeight) opts.height = Math.floor(height)
          chart.applyOptions(opts)
        })
      }
    }

    observerRef.current = new ResizeObserver(applySize)
    observerRef.current.observe(containerRef.current)

    // 초기 크기 적용
    const initialWidth = containerRef.current.clientWidth
    const initialHeight = containerRef.current.clientHeight
    if (initialWidth > 0) {
      chartRefs.forEach(ref => {
        const chart = ref.current
        if (!chart) return
        const opts = { width: Math.floor(initialWidth) }
        if (watchHeight) opts.height = Math.floor(initialHeight)
        chart.applyOptions(opts)
      })
    }

    return () => {
      observerRef.current?.disconnect()
    }
  // layoutKey: 로딩 끝난 뒤 ref가 붙은 뒤에 observer를 다시 연결
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, watchHeight, layoutKey])
}
