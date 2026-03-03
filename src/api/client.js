/**
 * API client for remote API requests.
 * Base URL is set via VITE_API_BASE_URL in .env (e.g. .env.local).
 */

const getBaseUrl = () => {
  const base = import.meta.env.VITE_API_BASE_URL
  if (base) return base.replace(/\/$/, '')
  return ''
}

/**
 * @param {string} path - Path (e.g. '/users' or 'users')
 * @param {RequestInit} [options] - fetch options
 * @returns {Promise<Response>}
 */
export async function apiRequest(path, options = {}) {
  const base = getBaseUrl()
  const url = path.startsWith('http') ? path : `${base}/${path.replace(/^\//, '')}`
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }
  const res = await fetch(url, { ...options, headers })
  return res
}

/**
 * GET and parse JSON.
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function apiGet(path, options = {}) {
  const res = await apiRequest(path, { ...options, method: 'GET' })
  if (!res.ok) {
    const err = new Error(res.statusText || `HTTP ${res.status}`)
    err.status = res.status
    err.response = res
    throw err
  }
  const contentType = res.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) return res.json()
  return res.text()
}

/**
 * POST JSON body.
 * @param {string} path
 * @param {object} [body]
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function apiPost(path, body, options = {}) {
  const res = await apiRequest(path, {
    ...options,
    method: 'POST',
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = new Error(res.statusText || `HTTP ${res.status}`)
    err.status = res.status
    err.response = res
    throw err
  }
  const contentType = res.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) return res.json()
  return res.text()
}

/**
 * PATCH with optional JSON body.
 * @param {string} path
 * @param {object} [body]
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
export async function apiPatch(path, body, options = {}) {
  const res = await apiRequest(path, {
    ...options,
    method: 'PATCH',
    body: body != null ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = new Error(res.statusText || `HTTP ${res.status}`)
    err.status = res.status
    err.response = res
    throw err
  }
  const contentType = res.headers.get('content-type')
  if (contentType && contentType.includes('application/json')) return res.json()
  return res.text()
}

export { getBaseUrl }
