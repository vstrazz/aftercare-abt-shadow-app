import React from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '../_layout'
import { applyAftercareConfig } from '../../aftercareConfig'

function AftercareTextPage() {
  applyAftercareConfig()
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
