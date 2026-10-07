import { useCallback, useState } from 'react'

/**
 * Every button that calls the backend needs the same two things, disable
 * itself while the call is in flight (so a second tap cannot fire a
 * second request before the first one lands) and show that something is
 * happening. Writing that pair of concerns once here, instead of a fresh
 * isSubmitting useState in every component, is what keeps every button
 * across the app behaving the same way instead of a handful of screens
 * quietly forgetting to add it.
 */
export function useAsyncAction(action) {
  const [isLoading, setIsLoading] = useState(false)

  const run = useCallback(async (...args) => {
    setIsLoading(true)
    try {
      return await action(...args)
    } finally {
      setIsLoading(false)
    }
  }, [action])

  return [run, isLoading]
}