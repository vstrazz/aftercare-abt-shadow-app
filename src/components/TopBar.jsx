import React from 'react'
import './TopBar.css'

const pageNames = {
  'dashboard': 'Dashboard',
  'obituaries': 'Obituaries',
  'audience': 'Audience',
  'aftercare-text': 'Aftercare Text',
  'website-content': 'Website Content',
  'users': 'Users',
  'events': 'Events',
  'reports': 'Reports',
  'proofs': 'Proofs',
  'settings': 'Settings',
}

export default function TopBar({ activePage }) {
  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span className="breadcrumb-icon">🏛</span>
        <span className="breadcrumb-org">Sonzini Mortuary</span>
        <span className="breadcrumb-sep">/</span>
        <span className="breadcrumb-page">{pageNames[activePage] || activePage}</span>
      </div>
      <div className="topbar-right">
        {activePage === 'aftercare-text' && (
          <a
            className="topbar-settings-link"
            href="https://www.aftercare.com/system"
            target="_blank"
            rel="noopener noreferrer"
          >
            ⚙️ Aftercare Text Settings
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        )}
        {activePage === 'obituaries' && (
          <button className="topbar-add-btn">+</button>
        )}
        <div className="topbar-avatar">
          <img
            src="https://ui-avatars.com/api/?name=S+M&background=1e293b&color=fff&size=36"
            alt="User"
          />
        </div>
      </div>
    </div>
  )
}
