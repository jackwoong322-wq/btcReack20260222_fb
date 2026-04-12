function SidebarSection({ sectionKey, section, expandedSection, selectedChart, onToggleSection, onSelect }) {
  return (
    <div className="nav-section">
      <button
        className="nav-section-header"
        onClick={() => onToggleSection(sectionKey)}
        aria-expanded={expandedSection === sectionKey}
        aria-controls={`${sectionKey}-cycle-list`}
      >
        <span className="nav-icon">{section.icon}</span>
        <span className="nav-text">{section.title}</span>
        <span className={`nav-arrow ${expandedSection === sectionKey ? 'expanded' : ''}`}>v</span>
      </button>

      <div id={`${sectionKey}-cycle-list`} className={`nav-section-items ${expandedSection === sectionKey ? 'expanded' : ''}`}>
        {section.cycles.map((cycle) => (
          <button
            key={cycle.id}
            className={`nav-subitem ${selectedChart === cycle.id ? 'active' : ''}`}
            onClick={() => onSelect(cycle.id)}
            aria-current={selectedChart === cycle.id ? 'page' : undefined}
          >
            <span className="nav-text">
              {cycle.label}
              {cycle.current && <span className="current-badge">현재</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SidebarNavigation({
  menuOpen,
  selectedChart,
  menuData,
  expandedSection,
  onSelect,
  onToggleSection,
}) {
  return (
    <aside
      id="sidebar-navigation"
      className={`sidebar ${menuOpen ? 'open' : ''}`}
      aria-hidden={!menuOpen}
      aria-label="사이클 차트 탐색"
    >
      <div className="sidebar-header">
        <span className="sidebar-logo">BC</span>
        <span className="sidebar-title">Bitcoin Cycle Desk</span>
        <span className="sidebar-copy">
          비트코인 사이클을 차분하게 읽는 데스크톱 분석 화면
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="차트 탐색">
        <button
          className={`nav-item ${selectedChart === 'comparison' ? 'active' : ''}`}
          onClick={() => onSelect('comparison')}
          aria-current={selectedChart === 'comparison' ? 'page' : undefined}
        >
          <span className="nav-icon">{menuData.comparison.icon}</span>
          <span className="nav-text">{menuData.comparison.title}</span>
        </button>

        <button
          className={`nav-item ${selectedChart === 'trading' ? 'active' : ''}`}
          onClick={() => onSelect('trading')}
          aria-current={selectedChart === 'trading' ? 'page' : undefined}
        >
          <span className="nav-icon">{menuData.trading.icon}</span>
          <span className="nav-text">{menuData.trading.title}</span>
          <span className="new-badge">LIVE</span>
        </button>

        <SidebarSection
          sectionKey="bear"
          section={menuData.bear}
          expandedSection={expandedSection}
          selectedChart={selectedChart}
          onToggleSection={onToggleSection}
          onSelect={onSelect}
        />

        <SidebarSection
          sectionKey="bull"
          section={menuData.bull}
          expandedSection={expandedSection}
          selectedChart={selectedChart}
          onToggleSection={onToggleSection}
          onSelect={onSelect}
        />
      </nav>
    </aside>
  )
}
