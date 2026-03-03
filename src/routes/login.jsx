import React from 'react'
import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import LoginPage from '../components/LoginPage'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from '@tanstack/react-router'

function LoginRouteComponent() {
  const { login } = useAuth()
  const navigate = useNavigate()
  return (
    <LoginPage
      onLogin={() => {
        login()
        navigate({ to: '/' })
      }}
    />
  )
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  component: LoginRouteComponent,
})
