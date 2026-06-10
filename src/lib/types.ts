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
  /** No public feed → episodes can't be ingested or transcribed. Rendered as a
   *  locked show; its episodes are suppressed so users never see fabricated data. */
  locked?: boolean
}

/** A plain conclusion — title + supporting detail. Used by the weekly digest,
 *  where points synthesise across episodes and have no single timestamp. */
export interface Takeaway {
  title: string
  detail: string
}

/** An episode highlight — the merged "takeaway + interesting moment": one beat
 *  worth revisiting, anchored to where in the episode it happens. */
export interface Highlight extends Takeaway {
  id: string
  timestamp: string // "45:12", or "—" when unknown (show-notes-only summaries)
  /** Links to a transcript segment so a click can jump straight to it. */
  segmentId?: string
  /** Flagged by the AI as one of the few most important — the key takeaways. */
  key?: boolean
}

export interface QAItem {
  q: string
  a: string
}

export interface TranscriptSegment {
  id: string
  speaker: string
  role: 'host' | 'guest'
  timestamp: string
  text: string
  /** When set, this segment contains a highlighted span tied to a summary module. */
  highlight?: {
    /** Matches a Highlight.id. */
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
  /** Timestamped highlights in timeline order; the `key` ones are the headline takeaways. */
  highlights: Highlight[]
  qa: QAItem[]
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

