import React from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '../_layout'

function AftercareTextPage() {
  // Pull API URL from env and expose to the widget (it can't read .env itself)
  if (typeof window !== 'undefined') {
    window.AFTERCARE_CONFIG = {
      apiBase: import.meta.env.VITE_API_BASE_URL || '',
      // account_api_key refers to the tukios_api_key stored on the accounts table.
      account_api_key: '9da68d93fb8e02f5a782fa895cde318e',
      apiKey: import.meta.env.VITE_API_KEY || '',
      firebaseDbUrl: import.meta.env.FIREBASE_DB_URL || '',
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
