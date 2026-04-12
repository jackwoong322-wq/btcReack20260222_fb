import { useState, useEffect, useMemo } from 'react'
import './styles/App.css'
import CycleComparisonChart from './components/CycleComparisonChart'
import BearBoxChart from './components/BearBoxChart'
import BullBoxChart from './components/BullBoxChart'
import TradingChart from './components/TradingChart'
import SidebarNavigation from './components/layout/SidebarNavigation'
import ChartScreenIntro from './components/layout/ChartScreenIntro'
import { fetchCycleMenu } from './lib/api'

const FALLBACK_BEAR_CYCLES = [
  { id: 'bear1', label: 'Cycle 1 (2013.12)', cycleNumber: 1 },
  { id: 'bear2', label: 'Cycle 2 (2017.12)', cycleNumber: 2 },
  { id: 'bear3', label: 'Cycle 3 (2021.11)', cycleNumber: 3 },
  { id: 'bear4', label: 'Cycle 4', cycleNumber: 4, current: true },
]

const FALLBACK_BULL_CYCLES = [
  { id: 'bull1', label: 'Cycle 1 (2013.12)', cycleNumber: 1 },
  { id: 'bull2', label: 'Cycle 2 (2017.12)', cycleNumber: 2 },
  { id: 'bull3', label: 'Cycle 3 (2021.11)', cycleNumber: 3 },
]

function mapApiCyclesToNav(items, idPrefix) {
  if (!items?.length) return null
  return items.map((cycle) => ({
    id: `${idPrefix}${cycle.number}`,
    label: cycle.label,
    cycleNumber: cycle.number,
    ...(cycle.current ? { current: true } : {}),
  }))
}

function App() {
  const [selectedChart, setSelectedChart] = useState('comparison')
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedSection, setExpandedSection] = useState('bear')
  const [headerContent, setHeaderContent] = useState(null)
  const [cycleMenu, setCycleMenu] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchCycleMenu()
      .then((data) => {
        if (!cancelled) setCycleMenu(data)
      })
      .catch(() => {
        if (!cancelled) setCycleMenu(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const menuData = useMemo(
    () => ({
      comparison: {
        title: '사이클 비교',
        icon: 'CP',
        type: 'comparison',
      },
      trading: {
        title: '트레이딩 뷰',
        icon: 'TV',
        type: 'trading',
      },
      bear: {
        title: '하락장 (0~400일)',
        icon: 'BR',
        cycles: mapApiCyclesToNav(cycleMenu?.bearCycles, 'bear') || FALLBACK_BEAR_CYCLES,
      },
      bull: {
        title: '상승장 (400일~)',
        icon: 'BL',
        cycles: mapApiCyclesToNav(cycleMenu?.bullCycles, 'bull') || FALLBACK_BULL_CYCLES,
      },
    }),
    [cycleMenu]
  )

  const getSelectedChartInfo = () => {
    if (selectedChart === 'comparison') {
      return { type: 'comparison', title: '사이클 비교' }
    }
    if (selectedChart === 'trading') {
      return { type: 'trading', title: '트레이딩 뷰' }
    }
    for (const section of ['bear', 'bull']) {
      const found = menuData[section].cycles.find((cycle) => cycle.id === selectedChart)
      if (found) {
        return {
          type: section,
          cycleNumber: found.cycleNumber,
          title: `${menuData[section].title} / ${found.label}`,
        }
      }
    }
    return { type: 'comparison', title: '사이클 비교' }
  }

  const selectedInfo = getSelectedChartInfo()

  const handleMenuClick = (chartId) => {
    setSelectedChart(chartId)
    setMenuOpen(false)
    if (chartId !== 'comparison') setHeaderContent(null)
  }

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  const renderChart = () => {
    switch (selectedInfo.type) {
      case 'comparison':
        return <CycleComparisonChart onHeaderContent={setHeaderContent} />
      case 'trading':
        return <TradingChart />
      case 'bear':
        return <BearBoxChart cycleNumber={selectedInfo.cycleNumber} />
      case 'bull':
        return <BullBoxChart cycleNumber={selectedInfo.cycleNumber} />
      default:
        return <CycleComparisonChart onHeaderContent={setHeaderContent} />
    }
  }

  return (
    <div className="app-container">
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>

      <header className="app-header">
        <button
          className="header-btn menu-btn"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={menuOpen}
          aria-controls="sidebar-navigation"
        >
          NAV
        </button>
        {headerContent && <div className="header-slot">{headerContent}</div>}
      </header>

      <SidebarNavigation
        menuOpen={menuOpen}
        selectedChart={selectedChart}
        menuData={menuData}
        expandedSection={expandedSection}
        onSelect={handleMenuClick}
        onToggleSection={toggleSection}
      />

      {menuOpen && (
        <button
          type="button"
          className="overlay"
          aria-label="사이드바 닫기"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main id="main-content" className="chart-fullscreen" tabIndex="-1">
        <section className="chart-shell">
          <ChartScreenIntro title={selectedInfo.title} />
          {renderChart()}
        </section>
      </main>
    </div>
  )
}

export default App

