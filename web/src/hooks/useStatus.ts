import { useState, useEffect, useCallback } from 'react'
import { api, type MachineStatus } from '../lib/api'

export function useStatus() {
  const [status, setStatus] = useState<MachineStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.getStatus()
      setStatus(data)
    } catch {
      // ignore errors for status polling
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { status, loading, refresh }
}
