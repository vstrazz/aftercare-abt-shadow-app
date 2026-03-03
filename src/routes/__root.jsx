import React from 'react'
import { createRootRoute, Outlet, Navigate, useLocation } from '@tanstack/react-router'
import { useAuth } from '../context/AuthContext'

function RootComponent() {
  const { isLoggedIn } = useAuth()
  const { pathname } = useLocation()
  if (!isLoggedIn && pathname !== '/login') return <Navigate to="/login" />
  if (isLoggedIn && pathname === '/login') return <Navigate to="/" />
  return <Outlet />
}

export const rootRoute = createRootRoute({
  component: RootComponent,
})
