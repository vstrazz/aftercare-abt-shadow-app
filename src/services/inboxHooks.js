/**
 * TanStack Query hooks for the text messaging inbox API.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRecipients,
  getConversations,
  getThread,
  getUnreadCount,
  markRead,
  sendMessage,
  stopRecipient,
} from './inboxService'

export const inboxQueryKeys = {
  all: ['inbox'],
  recipients: (params) => [...inboxQueryKeys.all, 'recipients', params ?? {}],
  conversations: (params) => [...inboxQueryKeys.all, 'conversations', params ?? {}],
  thread: (recipientId) => [...inboxQueryKeys.all, 'thread', recipientId],
  unreadCount: () => [...inboxQueryKeys.all, 'unread-count'],
}

/**
 * GET /recipients — Search/paginate recipients, optional archive filter.
 * @param {{ q?: string, limit?: number, offset?: number, archived?: boolean }} [params]
 */
export function useRecipients(params, options = {}) {
  return useQuery({
    queryKey: inboxQueryKeys.recipients(params),
    queryFn: () => getRecipients(params ?? {}),
    ...options,
  })
}

/**
 * GET /conversations — List conversations with unread counts, last message preview.
 * @param {{ limit?: number, offset?: number }} [params]
 */
export function useConversations(params, options = {}) {
  return useQuery({
    queryKey: inboxQueryKeys.conversations(params),
    queryFn: () => getConversations(params ?? {}),
    ...options,
  })
}

/**
 * GET /thread/:recipientId — Message thread with nested moderation data.
 * @param {string} recipientId - pass null/undefined to disable the query
 */
export function useThread(recipientId, options = {}) {
  return useQuery({
    queryKey: inboxQueryKeys.thread(recipientId),
    queryFn: () => getThread(recipientId),
    enabled: Boolean(recipientId),
    ...options,
  })
}

/**
 * GET /unread-count — Total unread count for the account.
 */
export function useUnreadCount(options = {}) {
  return useQuery({
    queryKey: inboxQueryKeys.unreadCount(),
    queryFn: getUnreadCount,
    ...options,
  })
}

/**
 * PATCH /mark-read — Mark messages read. Invalidates thread, conversations, unread-count.
 */
export function useMarkRead(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markRead,
    onSuccess: (_data, _variables, context) => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all })
    },
    ...options,
  })
}

/**
 * POST /thread/:recipientId — Send SMS (optional MMS via image). Invalidates that thread and conversations.
 * Call with: mutate({ recipientId, body, image? })
 */
export function useSendMessage(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ recipientId, body, image }) => sendMessage(recipientId, { body, image }),
    onSuccess: (_data, { recipientId }) => {
      if (recipientId) queryClient.invalidateQueries({ queryKey: inboxQueryKeys.thread(recipientId) })
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.conversations() })
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.unreadCount() })
    },
    ...options,
  })
}

/**
 * POST /stop/:recipientId — Suppress/unsubscribe recipient. Invalidates recipients, conversations, thread.
 * Call with: mutate(recipientId) or mutate({ recipientId })
 */
export function useStopRecipient(options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (recipientIdOrPayload) => {
      const id = typeof recipientIdOrPayload === 'string'
        ? recipientIdOrPayload
        : recipientIdOrPayload?.recipientId
      return stopRecipient(id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxQueryKeys.all })
    },
    ...options,
  })
}
