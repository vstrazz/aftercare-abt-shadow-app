import React from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '../_layout'

function AftercareTextPage() {
  // Pull API URL from env and expose to the widget (it can't read .env itself)
  if (typeof window !== 'undefined') {
    window.AFTERCARE_CONFIG = {
      apiBase: import.meta.env.VITE_API_BASE_URL || '',
      accountId: '1',
    }
  }
  return (
    <div className="aftercare-text-page">
      <div id="aftercare-text-root" />
    </div>
  )
}

export const aftercareTextRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'aftercare-text',
  component: AftercareTextPage,
})
