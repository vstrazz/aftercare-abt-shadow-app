import React, { useState } from 'react'
import { createRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Sidebar from '../components/Sidebar'
import TopBar from '../components/TopBar'
import '../App.css'

const pathToPageId = (pathname) => {
  if (pathname === '/' || pathname === '') return 'obituaries'
  const segment = pathname.replace(/^\//, '').split('/')[0]
  return segment || 'obituaries'
}

function LayoutComponent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const activePage = pathToPageId(pathname)

  return (
    <div className="app-layout">
      <Sidebar
        activePage={activePage}
        onNavigate={(id) => navigate({ to: `/${id}` })}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="main-area">
        <TopBar activePage={activePage} />
        <div className="content-area">
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
