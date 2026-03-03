import React from 'react'
import { createRoute } from '@tanstack/react-router'
import { layoutRoute } from '../_layout'
import ObituariesPage from '../../components/ObituariesPage'

export const obituariesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: 'obituaries',
  component: ObituariesPage,
})
