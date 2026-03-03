import React from 'react'
import { createRoute, useParams } from '@tanstack/react-router'
import { layoutRoute } from '../_layout'

function PlaceholderPage() {
  const params = useParams({ strict: false })
  const page = params.page
  const label = (page || '')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
  return (
    <div className="placeholder-page">
      <div className="placeholder-content">
        <div className="placeholder-icon">📄</div>
        <h2>{label || 'Page'}</h2>
        <p>This page is a placeholder for the demo.</p>
      </div>
    </div>
  )
}

export const layoutPageRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '$page',
  component: PlaceholderPage,
})
