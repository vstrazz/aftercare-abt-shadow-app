/**
 * Inbox service for the text messaging API.
 * Base URL from VITE_API_BASE_URL; paths match the API:
 *   GET /recipients, GET /conversations, GET /thread/:recipientId,
 *   PATCH /mark-read, GET /unread-count, GET /stream/:recipientId,
 *   POST /thread/:recipientId, POST /stop/:recipientId
 */

import { apiGet, apiPost, apiPatch } from '../api/client'
import { getBaseUrl } from '../api/client'

/**
 * GET /recipients — Search/paginate recipients by account, optional archive filter.
 * @param {{ q?: string, limit?: number, offset?: number, archived?: boolean }} [params]
 */
export async function getRecipients(params = {}) {
  const search = new URLSearchParams()
  if (params.q != null) search.set('q', params.q)
  if (params.limit != null) search.set('limit', String(params.limit))
  if (params.offset != null) search.set('offset', String(params.offset))
  if (params.archived != null) search.set('archived', String(params.archived))
  const qs = search.toString()
  const path = qs ? `recipients?${qs}` : 'recipients'
  return apiGet(path)
}

/**
 * GET /conversations — List conversations with unread counts, last message preview.
 * @param {{ limit?: number, offset?: number }} [params]
 */
export async function getConversations(params = {}) {
  const search = new URLSearchParams()
  if (params.limit != null) search.set('limit', String(params.limit))
  if (params.offset != null) search.set('offset', String(params.offset))
  const qs = search.toString()
  const path = qs ? `conversations?${qs}` : 'conversations'
  return apiGet(path)
}

/**
 * GET /thread/:recipientId — Message thread with nested moderation data.
 * @param {string} recipientId
 */
export async function getThread(recipientId) {
  if (!recipientId) throw new Error('recipientId is required')
  return apiGet(`thread/${encodeURIComponent(recipientId)}`)
}

/**
 * PATCH /mark-read — Mark messages read by IDs, recipient, or entire account.
 * @param {{ messageIds?: string[], recipientId?: string, account?: boolean }} body
 */
export async function markRead(body) {
  return apiPatch('mark-read', body)
}

/**
 * GET /unread-count — Total unread count for the account.
 */
export async function getUnreadCount() {
  return apiGet('unread-count')
}

/**
 * GET /stream/:recipientId — SSE stream for real-time message notifications.
 * Returns an EventSource; caller must call .close() when done.
 * @param {string} recipientId
 * @returns {EventSource}
 */
export function openStream(recipientId) {
  if (!recipientId) throw new Error('recipientId is required')
  const base = getBaseUrl()
  const url = `${base}/stream/${encodeURIComponent(recipientId)}`
  return new EventSource(url)
}

/**
 * POST /thread/:recipientId — Send outgoing SMS (optional MMS via image field).
 * @param {string} recipientId
 * @param {{ body: string, image?: string }} payload - body = message text, image = optional MMS URL/base64
 */
export async function sendMessage(recipientId, payload) {
  if (!recipientId) throw new Error('recipientId is required')
  return apiPost(`thread/${encodeURIComponent(recipientId)}`, payload)
}

/**
 * POST /stop/:recipientId — Suppress/unsubscribe a recipient.
 * @param {string} recipientId
 */
export async function stopRecipient(recipientId) {
  if (!recipientId) throw new Error('recipientId is required')
  return apiPost(`stop/${encodeURIComponent(recipientId)}`)
}
