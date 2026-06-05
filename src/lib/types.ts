// ─────────────────────────────────────────────────────────────────────────────
// Munshot Podcasts domain model
// These types are the contract between the UI and the (future) backend. The
// mock api in `api.ts` returns exactly these shapes, so swapping mock data for
// real `fetch()` calls is a drop-in change.
// ─────────────────────────────────────────────────────────────────────────────

/** The lifecycle a detected episode moves through before it's readable. */
export type ProcessingStatus =
  | 'detected' // new episode found on a tracked feed
  | 'fetching' // pulling the audio / video
  | 'transcribing' // sent to the transcription API
  | 'summarizing' // running the AI summary pass
  | 'ready' // one-page summary available
  | 'failed' // something broke; needs a retry

export type SourceKind = 'podcast' | 'youtube'

export interface Podcast {
  id: string
  title: string
  author: string
  category: string
  description: string
  /** Human cadence, e.g. "Weekly", "2–3 / week". */
  cadence: string
  episodeCount: number
  source: SourceKind
  /** Brand color + monogram drive the generated cover tile (no external images). */
  color: string
  monogram: string
  /** Real cover art (square). When absent, the UI falls back to color + monogram. */
  artworkUrl?: string
  tracked: boolean
}

export interface Takeaway {
  title: string
  detail: string
}

export interface QAItem {
  q: string
  a: string
}

/** A "double-click" moment the AI flagged as genuinely interesting. */
export interface InterestingMoment {
  id: string
  title: string
  timestamp: string // "45:12"
  whyItMatters: string
  /** Links to a transcript segment so "Open transcript" can jump to it. */
  segmentId?: string
}

export interface TranscriptSegment {
  id: string
  speaker: string
  role: 'host' | 'guest'
  timestamp: string
  text: string
  /** When set, this segment contains a highlighted span tied to a summary module. */
  highlight?: {
    /** Matches an InterestingMoment.id or a takeaway anchor. */
    refId: string
    /** The exact substring of `text` to wrap in a <mark>. */
    quote: string
    label: string
  }
}

/** The one-page AI summary — everything a single episode produces. */
export interface Summary {
  /** The readable one-page synthesis, as paragraphs. */
  synthesis: string[]
  takeaways: Takeaway[]
  qa: QAItem[]
  moments: InterestingMoment[]
}

export interface EpisodeEntities {
  people: string[]
  companies: string[]
  themes: string[]
}

export interface Episode {
  id: string
  podcastId: string
  title: string
  publishedAt: string // ISO date
  durationSec: number
  status: ProcessingStatus
  signal: 'high' | 'normal'
  /** One-line teaser shown in lists and the hero card. */
  blurb: string
  /** Deep link to the episode at its origin (Apple Podcasts, YouTube, RSS). When absent, the UI falls back to a source search. */
  sourceUrl?: string
  /** Publisher show-notes (trimmed) — fallback material for the AI summary when no transcript exists. */
  notes?: string
  /** Publisher-provided transcript file (SRT/VTT) from the feed, when available — preferred summary source. */
  transcriptUrl?: string
  /** Audio enclosure URL — source for Whisper transcription (paid/free-tier providers). */
  audioUrl?: string
  entities: EpisodeEntities
  /** Present once status === 'ready'. */
  summary?: Summary
  transcript?: TranscriptSegment[]
}

export interface WeeklySummary {
  id: string
  rangeLabel: string // "May 19 – May 25, 2026"
  episodeCount: number
  readMinutes: number
  /** "This week in summary" prose. */
  overview: string[]
  topThemes: { label: string; momentum: number }[]
  /** "What was actually interesting" pull-quote. */
  interesting: { quote: string; speaker: string; role: string; episodeId: string }
  takeaways: Takeaway[]
  contradictions: string[]
  mentions: { people: string[]; companies: string[] }
  questions: string[]
  sourceEpisodeIds: string[]
}

