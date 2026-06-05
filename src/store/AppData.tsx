import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Episode, Podcast, Settings, WeeklySummary } from '../lib/types'
import * as api from '../lib/api'

// One provider loads everything through the api seam on mount and hands it to
// the app via context, so individual pages stay synchronous and snappy.

interface AppData {
  loading: boolean
  podcasts: Podcast[]
  episodes: Episode[]
  weekly: WeeklySummary | null
  settings: Settings
  // selectors
  podcastById: (id: string) => Podcast | undefined
  episodeById: (id: string) => Episode | undefined
  episodesByPodcast: (podcastId: string) => Episode[]
  // mutations
  toggleTracked: (id: string) => void
  saveSettings: (next: Settings) => void
}

const Ctx = createContext<AppData | null>(null)

const FALLBACK_SETTINGS: Settings = {
  summaryLength: 'standard',
  weeklySummary: true,
  emailNotifications: true,
  email: '',
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null)
  const [settings, setSettings] = useState<Settings>(FALLBACK_SETTINGS)

  useEffect(() => {
    let alive = true
    Promise.all([api.listPodcasts(), api.listEpisodes(), api.getWeekly(), api.getSettings()]).then(
      ([p, e, w, s]) => {
        if (!alive) return
        setPodcasts(p)
        setEpisodes(e)
        setWeekly(w)
        setSettings(s)
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const podcastById = useCallback((id: string) => podcasts.find((p) => p.id === id), [podcasts])
  const episodeById = useCallback((id: string) => episodes.find((e) => e.id === id), [episodes])
  const episodesByPodcast = useCallback(
    (podcastId: string) => episodes.filter((e) => e.podcastId === podcastId),
    [episodes],
  )

  const toggleTracked = useCallback((id: string) => {
    setPodcasts((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, tracked: !p.tracked } : p))
      const target = next.find((p) => p.id === id)
      if (target) void api.setPodcastTracked(id, target.tracked) // optimistic
      return next
    })
  }, [])

  const saveSettings = useCallback((next: Settings) => {
    setSettings(next)
    void api.updateSettings(next) // optimistic
  }, [])

  const value = useMemo<AppData>(
    () => ({
      loading,
      podcasts,
      episodes,
      weekly,
      settings,
      podcastById,
      episodeById,
      episodesByPodcast,
      toggleTracked,
      saveSettings,
    }),
    [loading, podcasts, episodes, weekly, settings, podcastById, episodeById, episodesByPodcast, toggleTracked, saveSettings],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppData must be used within <AppDataProvider>')
  return ctx
}
