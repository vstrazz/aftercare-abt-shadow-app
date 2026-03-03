import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from './client'

/**
 * Example: fetch data from a remote endpoint with TanStack Query.
 * Use queryKey to cache and invalidate, queryFn to call the API.
 */
export function useApiQuery(key, path, options = {}) {
  return useQuery({
    queryKey: key,
    queryFn: () => apiGet(path),
    ...options,
  })
}

/**
 * Example: POST and then invalidate a query so it refetches.
 */
export function useApiMutation(invalidateKeys = [], options = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    ...options,
    onSuccess: (data, variables, context) => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }))
      options.onSuccess?.(data, variables, context)
    },
  })
}
