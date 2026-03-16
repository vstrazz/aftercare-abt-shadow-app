import React from 'react'
import { createRoute, Outlet } from '@tanstack/react-router'
import { rootRoute } from './__root'
import '../App.css'

function LayoutComponent() {
  return (
    <div className="app-layout" style={{ height: '100vh' }}>
      <div className="main-area" style={{ flex: 1 }}>
        <div className="content-area" style={{ height: '100%' }}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: LayoutComponent,
})
