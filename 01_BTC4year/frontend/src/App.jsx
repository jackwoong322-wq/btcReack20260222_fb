import { useState } from 'react'
import './styles/App.css'
import CycleComparisonChart from './components/CycleComparisonChart'
import BearBoxChart from './components/BearBoxChart'
import BullBoxChart from './components/BullBoxChart'
import TradingChart from './components/TradingChart'

function App() {
  const [selectedChart, setSelectedChart] = useState('comparison')
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedSection, setExpandedSection] = useState('bear')

  const menuData = {
    comparison: { 
      title: '사이클 비교', 
      icon: '📈',
      type: 'comparison' 
    },
    trading: {
      title: '트레이딩 뷰',
      icon: '📊',
      type: 'trading'
    },
    bear: {
      title: '하락장 (0~420일)',
      icon: '🐻',
      cycles: [
        { id: 'bear1', label: 'Cycle 1 (2013.12)', cycleNumber: 1 },
        { id: 'bear2', label: 'Cycle 2 (2017.12)', cycleNumber: 2 },
        { id: 'bear3', label: 'Cycle 3 (2021.11)', cycleNumber: 3 },
        { id: 'bear4', label: 'Cycle 4 (2025.01)', cycleNumber: 4, current: true },
      ]
    },
    bull: {
      title: '상승장 (420일~)',
      icon: '🐂',
      cycles: [
        { id: 'bull1', label: 'Cycle 1 (2013.12)', cycleNumber: 1 },
        { id: 'bull2', label: 'Cycle 2 (2017.12)', cycleNumber: 2 },
        { id: 'bull3', label: 'Cycle 3 (2021.11)', cycleNumber: 3 },
      ]
    }
  }

  const getSelectedChartInfo = () => {
    if (selectedChart === 'comparison') {
      return { type: 'comparison', title: '사이클 비교' }
    }
    if (selectedChart === 'trading') {
      return { type: 'trading', title: '트레이딩 뷰' }
    }
    for (const section of ['bear', 'bull']) {
      const found = menuData[section].cycles.find(c => c.id === selectedChart)
      if (found) {
        return { 
          type: section, 
          cycleNumber: found.cycleNumber, 
          title: `${menuData[section].icon} ${found.label}` 
        }
      }
    }
    return { type: 'comparison', title: '사이클 비교' }
  }

  const handleMenuClick = (chartId) => {
    setSelectedChart(chartId)
    setMenuOpen(false)
  }

  const toggleSection = (section) => {
    setExpandedSection(expandedSection === section ? null : section)
  }

  const renderChart = () => {
    const info = getSelectedChartInfo()
    switch (info.type) {
      case 'comparison':
        return <CycleComparisonChart />
      case 'trading':
        return <TradingChart />
      case 'bear':
        return <BearBoxChart cycleNumber={info.cycleNumber} />
      case 'bull':
        return <BullBoxChart cycleNumber={info.cycleNumber} />
      default:
        return <CycleComparisonChart />
    }
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <button 
          className="header-btn menu-btn"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="메뉴"
        >
          ☰
        </button>
      </header>

      <div className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <span className="sidebar-logo">📊</span>
          <span className="sidebar-title">Bitcoin Cycle</span>
        </div>
        
        <nav className="sidebar-nav">
          <button
            className={`nav-item ${selectedChart === 'comparison' ? 'active' : ''}`}
            onClick={() => handleMenuClick('comparison')}
          >
            <span className="nav-icon">{menuData.comparison.icon}</span>
            <span className="nav-text">{menuData.comparison.title}</span>
          </button>

          <button
            className={`nav-item ${selectedChart === 'trading' ? 'active' : ''}`}
            onClick={() => handleMenuClick('trading')}
            style={{ background: selectedChart === 'trading' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : '' }}
          >
            <span className="nav-icon">{menuData.trading.icon}</span>
            <span className="nav-text">{menuData.trading.title}</span>
            <span className="new-badge">NEW</span>
          </button>

          <div className="nav-section">
            <button 
              className="nav-section-header"
              onClick={() => toggleSection('bear')}
            >
              <span className="nav-icon">{menuData.bear.icon}</span>
              <span className="nav-text">{menuData.bear.title}</span>
              <span className={`nav-arrow ${expandedSection === 'bear' ? 'expanded' : ''}`}>▾</span>
            </button>
            
            <div className={`nav-section-items ${expandedSection === 'bear' ? 'expanded' : ''}`}>
              {menuData.bear.cycles.map(cycle => (
                <button
                  key={cycle.id}
                  className={`nav-subitem ${selectedChart === cycle.id ? 'active' : ''}`}
                  onClick={() => handleMenuClick(cycle.id)}
                >
                  <span className="nav-text">
                    {cycle.label}
                    {cycle.current && <span className="current-badge">⭐</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="nav-section">
            <button 
              className="nav-section-header"
              onClick={() => toggleSection('bull')}
            >
              <span className="nav-icon">{menuData.bull.icon}</span>
              <span className="nav-text">{menuData.bull.title}</span>
              <span className={`nav-arrow ${expandedSection === 'bull' ? 'expanded' : ''}`}>▾</span>
            </button>
            
            <div className={`nav-section-items ${expandedSection === 'bull' ? 'expanded' : ''}`}>
              {menuData.bull.cycles.map(cycle => (
                <button
                  key={cycle.id}
                  className={`nav-subitem ${selectedChart === cycle.id ? 'active' : ''}`}
                  onClick={() => handleMenuClick(cycle.id)}
                >
                  <span className="nav-text">{cycle.label}</span>
                </button>
              ))}
            </div>
          </div>
        </nav>
      </div>

      {menuOpen && (
        <div 
          className="overlay" 
          onClick={() => setMenuOpen(false)}
        />
      )}

      <main className="chart-fullscreen">
        {renderChart()}
      </main>
    </div>
  )
}

export default App
