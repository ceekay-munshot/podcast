import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Episode, Podcast, ProcessingStatus, WeeklySummary } from '../lib/types'
import * as api from '../lib/api'
import { loadProcessed, saveProcessed } from '../lib/processedStore'
import { loadTracked, removeTracked, saveTracked } from '../lib/trackedStore'

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
  /** Track a podcast from a directory search result: merges it into the list,
   *  persists it (localStorage), and detects its recent episodes. */
  addPodcast: (podcast: Podcast) => void
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

// Compare a feed URL ignoring trivial formatting differences (trailing slash, host case).
function canonicalFeed(url?: string): string {
  if (!url) return ''
  try {
    const u = new URL(url.trim())
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`
  } catch {
    return url.trim().toLowerCase()
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// Layered identity for de-duping an added podcast against the existing list:
// same id → same canonical feed → same normalized title + author. (Not title
// alone — iTunes author strings can differ from curated seed authors.)
function samePodcast(a: Podcast, b: Podcast): boolean {
  if (a.id === b.id) return true
  const af = canonicalFeed(a.feedUrl)
  const bf = canonicalFeed(b.feedUrl)
  if (af && bf && af === bf) return true
  return norm(a.title) === norm(b.title) && norm(a.author) === norm(b.author)
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [podcasts, setPodcasts] = useState<Podcast[]>([])
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null)
  const [needsApiKey, setNeedsApiKey] = useState(false)
  const summarizing = useRef<Set<string>>(new Set()) // episode ids with an in-flight summary request
  // Ids in the seed/curated list — lets the mutation callbacks tell a user-added
  // show (which we persist + prune) from a built-in one. Populated on load.
  const seedIds = useRef<Set<string>>(new Set())
  // Latest podcasts mirrored into a ref so the stable callbacks below can read the
  // current list without being re-created (and re-subscribing consumers) on change.
  const podcastsRef = useRef<Podcast[]>([])

  // Union new episodes into state, keeping any existing (e.g. already-summarized) copy.
  const mergeEpisodes = useCallback((eps: Episode[]) => {
    if (!eps.length) return
    setEpisodes((prev) => {
      const m = new Map(prev.map((e) => [e.id, e]))
      for (const e of eps) if (!m.has(e.id)) m.set(e.id, e)
      return [...m.values()]
    })
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([api.listPodcasts(), api.listEpisodes(), api.getWeekly()]).then(([p, e, w]) => {
      if (!alive) return
      seedIds.current = new Set(p.map((x) => x.id))
      // Merge user-added podcasts (persisted in localStorage) ahead of the seed
      // list, de-duped by id so a persisted copy of a seed show can't double it.
      const persisted = loadTracked().filter((tp) => !seedIds.current.has(tp.id))
      const merged = [...persisted, ...p]
      // Locked shows have no public feed — drop any (seed) episodes for them so a
      // fabricated summary/transcript can never reach the UI. Single chokepoint:
      // Home, Episodes, Search, Weekly, and the channel selector all derive from this.
      const locked = new Set(p.filter((x) => x.locked).map((x) => x.id))
      // Re-hydrate the episodes this browser has already processed (persisted in
      // localStorage), so a reload — or a code-push redeploy — never drops that
      // history. Persisted (ready) versions overlay the freshly-fetched feed by id;
      // any that have since rolled off the feed are added back at the end.
      const byId = new Map<string, Episode>()
      for (const ep of e) byId.set(ep.id, ep)
      for (const ep of loadProcessed()) byId.set(ep.id, ep)
      setPodcasts(merged)
      setEpisodes([...byId.values()].filter((ep) => !locked.has(ep.podcastId)))
      setWeekly(w)
      setLoading(false)
      // Detect each user-added feed's recent episodes (best-effort, non-blocking).
      for (const tp of persisted) {
        if (!tp.feedUrl) continue
        api.fetchFeedEpisodes(tp.feedUrl, tp.id).then((eps) => {
          if (alive) mergeEpisodes(eps)
        })
      }
    })
    return () => {
      alive = false
    }
  }, [mergeEpisodes])

  // Keep the ref in step with the latest podcasts for the stable callbacks.
  useEffect(() => {
    podcastsRef.current = podcasts
  }, [podcasts])

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
    const current = podcastsRef.current.find((p) => p.id === id)
    if (!current) return
    const nowTracked = !current.tracked
    setPodcasts((prev) => prev.map((p) => (p.id === id ? { ...p, tracked: nowTracked } : p)))
    void api.setPodcastTracked(id, nowTracked) // optimistic
    // Only user-added shows persist. Re-detect episodes when re-tracked; on untrack,
    // drop their episodes from the session so a custom feed doesn't linger on Episodes.
    if (!seedIds.current.has(id)) {
      if (nowTracked) {
        saveTracked({ ...current, tracked: true })
        if (current.feedUrl) api.fetchFeedEpisodes(current.feedUrl, id).then(mergeEpisodes)
      } else {
        removeTracked(id)
        setEpisodes((prev) => prev.filter((e) => e.podcastId !== id))
      }
    }
  }, [mergeEpisodes])

  const addPodcast = useCallback(
    (incoming: Podcast) => {
      const entry: Podcast = { ...incoming, tracked: true }
      const match = podcastsRef.current.find((p) => samePodcast(p, entry))
      if (match) {
        // Already known (often a seed show surfaced by search) — just ensure it's tracked.
        setPodcasts((prev) => prev.map((p) => (p.id === match.id ? { ...p, tracked: true } : p)))
        void api.setPodcastTracked(match.id, true)
        if (!seedIds.current.has(match.id)) {
          saveTracked({ ...match, tracked: true })
          if (match.feedUrl) api.fetchFeedEpisodes(match.feedUrl, match.id).then(mergeEpisodes)
        }
        return
      }
      setPodcasts((prev) =>
        prev.some((p) => p.id === entry.id) ? prev.map((p) => (p.id === entry.id ? { ...p, tracked: true } : p)) : [entry, ...prev],
      )
      saveTracked(entry)
      if (entry.feedUrl) api.fetchFeedEpisodes(entry.feedUrl, entry.id).then(mergeEpisodes)
    },
    [mergeEpisodes],
  )

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
      const ready: Partial<Episode> = { summary, ...(transcript?.length ? { transcript } : {}) }
      setStatus('ready', ready)
      // Remember it so this work survives a reload / redeploy (see processedStore).
      saveProcessed({ ...episode, status: 'ready', ...ready })
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
      addPodcast,
      summarizeEpisode,
    }),
    [loading, podcasts, episodes, weekly, needsApiKey, podcastById, episodeById, episodesByPodcast, toggleTracked, addPodcast, summarizeEpisode],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAppData(): AppData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAppData must be used within <AppDataProvider>')
  return ctx
}
