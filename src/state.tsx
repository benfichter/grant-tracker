import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Opportunity, Profile } from './lib/types.ts'
import { todayIso } from './lib/dates.ts'
import { api } from './api.ts'

interface Toast {
  text: string
  tone: 'bad' | 'ok'
}

interface AppState {
  opps: Opportunity[]
  profile: Profile | null
  today: string
  loading: boolean
  loadError: string | null
  reload: () => Promise<void>
  toast: (text: string, tone?: 'bad' | 'ok') => void
  /** Run an API action; report failures as a toast and refresh the tracker afterwards. */
  act: <T>(fn: () => Promise<T>, okText?: string) => Promise<T | undefined>
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toastState, setToast] = useState<Toast | null>(null)
  const today = useMemo(() => todayIso(), [])

  const reload = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([api.opps(), api.profile()])
      setOpps(o)
      setProfile(p)
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const toast = useCallback((text: string, tone: 'bad' | 'ok' = 'bad') => {
    setToast({ text, tone })
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), tone === 'ok' ? 3000 : 7000)
  }, [])

  const act = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        await reload()
        if (okText) toast(okText, 'ok')
        return r
      } catch (e) {
        toast((e as Error).message)
        return undefined
      }
    },
    [reload, toast],
  )

  const value = useMemo(() => ({ opps, profile, today, loading, loadError, reload, toast, act }), [opps, profile, today, loading, loadError, reload, toast, act])

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastState && (
        <div className={`toast ${toastState.tone === 'ok' ? 'ok' : ''}`} role="status" onClick={() => setToast(null)}>
          {toastState.text}
        </div>
      )}
    </Ctx.Provider>
  )
}
