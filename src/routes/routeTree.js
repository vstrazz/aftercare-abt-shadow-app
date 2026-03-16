import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './__root'
import { layoutRoute } from './_layout'
import { layoutIndexRoute } from './_layout/index'
import { aftercareTextRoute } from './_layout/aftercare-text'

const routeTree = rootRoute.addChildren([
  layoutRoute.addChildren([
    layoutIndexRoute,
    aftercareTextRoute,
  ]),
])

export const router = createRouter({ routeTree })
