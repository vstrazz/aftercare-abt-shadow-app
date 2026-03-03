import React from 'react'
import './ObituariesPage.css'

const obituaries = [
  { name: 'Kyle S.', date: 'Dec 15, 9999', status: 'Published', location: 'Sonzini Mortuary - Ogden', img: 'KS', pinned: true, hasDot: true },
  { name: 'John Doe', date: 'Mar 30, 2023', status: 'Published', location: 'Sonzini Mortuary - Ogden', img: 'JD', pinned: true },
  { name: 'Garrett Otto', date: 'Oct 8, 2022', status: 'Draft', location: 'Sonzini Mortuary - Ogden', img: 'GO', pinned: true },
  { name: 'Joe Pistachio', date: 'Sep 9, 9999', status: 'Published', location: 'Sonzini Mortuary - Ogden', img: 'JP' },
  { name: 'John "J.D" Doe', date: 'Feb 5, 3000', status: 'Draft', location: 'Sonzini Mortuary - Ogden', img: 'JD' },
  { name: 'Morgan Test', date: 'Aug 14, 3000', status: 'Published', location: 'Sonzini Mortuary - Ogden', img: 'MT' },
  { name: 'Ferdinand J Vanderhoek', date: 'Feb 2, 2250', status: 'Draft', location: 'Sonzini Mortuary - Ogden', img: 'FV' },
  { name: 'Gracie Lou Hart', date: 'Nov 16, 2122', status: 'Draft', location: 'Sonzini Mortuary - Ogden', img: 'GL' },
]

export default function ObituariesPage() {
  return (
    <div className="obit-page">
      <div className="obit-search-bar">
        <input type="text" placeholder="Search obituaries" className="obit-search-input" />
        <svg className="obit-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8b8fa3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      </div>

      <div className="obit-toolbar">
        <span className="obit-count">Showing 1 to 20 of 628 results</span>
        <div className="obit-toolbar-right">
          <label className="obit-toggle">
            <span className="toggle-track"><span className="toggle-knob"></span></span>
            <span>Only</span>
            <span className="obit-dot-red">●</span>
          </label>
          <select className="obit-location-select">
            <option>Choose Location</option>
            <option>Sonzini Mortuary - Ogden</option>
          </select>
        </div>
      </div>

      <div className="obit-grid">
        {obituaries.map((obit, i) => (
          <div key={i} className="obit-card">
            {obit.hasDot && <span className="obit-card-dot">●</span>}
            {obit.pinned && <span className="obit-card-pin">★</span>}
            {!obit.pinned && <span className="obit-card-pin unpinned">☆</span>}
            <div className="obit-card-photo">
              <div className="obit-card-initials">{obit.img}</div>
            </div>
            <div className="obit-card-name">{obit.name}</div>
            <div className="obit-card-date">{obit.date}</div>
            <div className={`obit-card-status ${obit.status.toLowerCase()}`}>{obit.status}</div>
            <div className="obit-card-footer">
              <span className="obit-card-location">{obit.location}</span>
              <div className="obit-card-actions">
                <span>📋</span>
                {obit.status === 'Published' && <><span>📘</span><span>🐦</span></>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
