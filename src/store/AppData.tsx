import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Episode, Podcast, ProcessingStatus, WeeklySummary } from '../lib/types'
import * as api from '../lib/api'

// One provider loads everything through the api seam on mount and hands it to
// the app via context, so individual pages stay synchronous and snappy.

interface AppData {
  loading: boolean
  podcasts: Podcast[]
  episodes: Episode[]
  weekly: WeeklySummary | null
  /** True once a summary request came back "no API key configured". */
  needsApiKey: boolean
  // selectors
  podcastById: (id: string) => Podcast | undefined
  episodeById: (id: string) => Episode | undefined
  episodesByPodcast: (podcastId: string) => Episode[]
  // mutations
  toggleTracked: (id: string) => void
  /** Generate a real AI summary for an episode from its show-notes (idempotent). */
  summarizeEpisode: (episode: Episode, podcast?: Podcast) => void
}

const Ctx = createContext<AppData | null>(null)

// Pipeline order driving the simulated processing progression below.
const PIPELINE_ORDER: ProcessingStatus[] = ['detected', 'fetching', 'transcribing', 'summarizing', 'ready']

function nextStatus(status: ProcessingStatus): ProcessingStatus | null {
  if (status === 'ready' || status === 'failed') return null
  const i = PIPELINE_ORDER.indexOf(status)
  return i >= 0 && i < PIPELINE_ORDER.length - 1 ? PIPELINE_ORDER[i + 1] : null
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null)
  const [needsApiKey, setNeedsApiKey] = useState(false)
  const summarizing = useRef<Set<string>>(new Set()) // episode ids with an in-flight summary request

  useEffect(() => {
    let alive = true
    Promise.all([api.listPodcasts(), api.listEpisodes(), api.getWeekly()]).then(([p, e, w]) => {
      if (!alive) return
      setPodcasts(p)
      setEpisodes(e)
      setWeekly(w)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  // Simulated pipeline: advance any in-progress episode one stage every few
  // seconds so the processing UI genuinely moves. There is no real backend yet —
  // this is a client-side simulation. Swap it for a poll / websocket against the
  // real API and the same `status` field keeps driving the UI unchanged.
  useEffect(() => {
    if (loading) return
    const timer = setInterval(() => {
      setEpisodes((prev) => {
        // Only advance episodes that have a summary to land on — real feed
        // episodes have none yet, so they stay put (no fake "processing" churn).
        if (!prev.some((e) => e.summary && nextStatus(e.status))) return prev
        return prev.map((e) => {
          if (!e.summary) return e
          const next = nextStatus(e.status)
          return next ? { ...e, status: next } : e
        })
      })
    }, 4500)
    return () => clearInterval(timer)
  }, [loading])

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

  const summarizeEpisode = useCallback(async (episode: Episode, podcast?: Podcast) => {
    // Skip only if already summarized/in-flight, or there's nothing to work from.
    // audioUrl counts: Groq/Deepgram can transcribe it even with no notes or feed transcript.
    if (episode.summary || (!episode.notes && !episode.transcriptUrl && !episode.audioUrl) || summarizing.current.has(episode.id)) return
    summarizing.current.add(episode.id)
    const setStatus = (status: Episode['status'], patch?: Partial<Episode>) =>
      setEpisodes((prev) => prev.map((e) => (e.id === episode.id ? { ...e, status, ...(patch ?? {}) } : e)))
    setStatus('summarizing')
    try {
      const { summary, transcript } = await api.generateSummary({
        title: episode.title,
        show: podcast?.title ?? '',
        notes: episode.notes,
        transcriptUrl: episode.transcriptUrl,
        audioUrl: episode.audioUrl,
      })
      setStatus('ready', { summary, ...(transcript?.length ? { transcript } : {}) })
      setNeedsApiKey(false)
    } catch (err) {
      if (err instanceof api.NoApiKeyError) {
        setNeedsApiKey(true)
        setStatus('detected') // not a real failure — just no key configured yet
      } else {
        setStatus('failed')
      }
    } finally {
      summarizing.current.delete(episode.id)
    }
  }, [])

  const value = useMemo<AppData>(
    () => ({
      loading,
      podcasts,
      episodes,
      weekly,
      needsApiKey,
      podcastById,
      episodeById,
      episodesByPodcast,
      toggleTracked,
      summarizeEpisode,
    }),
    [loading, podcasts, episodes, weekly, needsApiKey, podcastById, episodeById, episodesByPodcast, toggleTracked, summarizeEpisode],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppData must be used within <AppDataProvider>')
  return ctx
}
