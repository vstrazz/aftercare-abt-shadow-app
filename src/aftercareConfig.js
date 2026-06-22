/**
 * Shared host config for the standalone aftercare-text-widget script.
 * Must run before the widget initializes (see main.jsx).
 */
export function applyAftercareConfig() {
  if (typeof window === 'undefined') return

  const existing = window.AFTERCARE_CONFIG || {}

  window.AFTERCARE_CONFIG = {
    ...existing,
    apiBase: import.meta.env.VITE_API_BASE_URL || existing.apiBase || '',
    account_api_key:
      existing.account_api_key ||
      import.meta.env.VITE_ACCOUNT_API_KEY ||
      '9da68d93fb8e02f5a782fa895cde318e',
    apiKey: import.meta.env.VITE_API_KEY || existing.apiKey || existing.api_key || '',
    firebaseDbUrl: resolveFirebaseDbUrl(
      import.meta.env.FIREBASE_DB_URL || existing.firebaseDbUrl || '',
    ),
  }
}

function resolveFirebaseDbUrl(raw) {
  const url = typeof raw === 'string' ? raw.trim() : ''
  if (!url) return ''
  if (/herokuapp\.com/i.test(url)) return ''
  return url
}
