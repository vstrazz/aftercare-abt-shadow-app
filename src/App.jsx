import React, { useState } from 'react'
import Sidebar from './components/Sidebar'
import TopBar from './components/TopBar'
import ObituariesPage from './components/ObituariesPage'
import LoginPage from './components/LoginPage'
import './App.css'

function App() {
  const [isLoggedIn, setIsLoggedIn]             = useState(false)
  const [activePage, setActivePage]             = useState('obituaries')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  if (!isLoggedIn) {
    return <LoginPage onLogin={() => setIsLoggedIn(true)} />
  }

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={setActivePage}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="main-area">
        <TopBar activePage={activePage} />
        <div className="content-area">
          {activePage === 'obituaries' && <ObituariesPage />}
          {activePage === 'aftercare-text' && (
            <div className="aftercare-text-page">
              {/*
                This is the container the Aftercare Text script targets.
                The script finds this div by ID and renders the full inbox inside it.
                In production, this div is the only thing Tukios needs in their template.
              */}
              <div id="aftercare-text-root"></div>
            </div>
          )}
          {activePage !== 'obituaries' && activePage !== 'aftercare-text' && (
            <div className="placeholder-page">
              <div className="placeholder-content">
                <div className="placeholder-icon">📄</div>
                <h2>{activePage.charAt(0).toUpperCase() + activePage.slice(1).replace('-', ' ')}</h2>
                <p>This page is a placeholder for the demo.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
