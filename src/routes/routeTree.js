import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './__root'
import { loginRoute } from './login'
import { layoutRoute } from './_layout'
import { layoutIndexRoute } from './_layout/index'
import { obituariesRoute } from './_layout/obituaries'
import { aftercareTextRoute } from './_layout/aftercare-text'
import { layoutPageRoute } from './_layout/$page'

/* prettier-ignore */
const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    layoutIndexRoute,
    obituariesRoute,
    aftercareTextRoute,
    layoutPageRoute,
  ]),
])

export const router = createRouter({ routeTree })
