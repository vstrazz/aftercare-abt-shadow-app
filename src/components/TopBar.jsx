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
