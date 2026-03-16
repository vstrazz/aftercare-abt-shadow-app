import React from 'react'
import { createRoute, Navigate } from '@tanstack/react-router'
import { layoutRoute } from '../_layout'

export const layoutIndexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  component: () => <Navigate to="/aftercare-text" />,
})
