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
  /** Canonical RSS/Atom feed. Set for user-added shows (carried from search so
   *  their episodes can be detected); seed shows keep their feeds server-side. */
  feedUrl?: string
  tracked: boolean
  /** No public feed → episodes can't be ingested or transcribed. Rendered as a
   *  locked show; its episodes are suppressed so users never see fabricated data. */
  locked?: boolean
}

/** A directory search hit (Apple Podcasts / resolved RSS / YouTube channel).
 *  Mirrors the server's `PodcastSearchResult` (server/search.ts) — the wire shape
 *  the /api/search-podcasts endpoint returns. */
export interface PodcastSearchResult {
  id: string
  title: string
  author: string
  category: string
  description: string
  artworkUrl?: string
  feedUrl: string
  source: SourceKind
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

export type ToneSentiment = 'positive' | 'negative' | 'neutral'

/** One thing the episode actually discusses, with the sentiment expressed toward it. */
export interface ToneAspect {
  /** A real company / person / topic, e.g. "SpaceX", "secondary markets". */
  subject: string
  sentiment: ToneSentiment
  /** Short, specific reason drawn from the material. */
  note: string
}

/** A context-aware tone read produced by the summarizer LLM (not the lexicon). */
export interface EpisodeTone {
  // Intentionally mirrors `ToneLabel` (src/lib/tone.ts) WITHOUT importing it — tone.ts
  // imports this module, so importing back would be a circular dependency.
  overall: 'positive' | 'cautious' | 'mixed' | 'neutral'
  /** ONE sentence explaining the net read, grounded in the episode. */
  rationale: string
  /** 3-6 aspects — the "about what" behind the net read. */
  aspects: ToneAspect[]
}

/** The one-page AI summary — everything a single episode produces. */
export interface Summary {
  /** The readable one-page synthesis, as paragraphs. */
  synthesis: string[]
  takeaways: Takeaway[]
  qa: QAItem[]
  moments: InterestingMoment[]
  /** Context-aware tone read from the summarizer LLM. Optional: older cached
   *  summaries (and mock data) predate it and fall back to the lexicon roll-up. */
  tone?: EpisodeTone
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
  /** "What was actually interesting" — a curated moment: a headline + the insight. */
  interesting: { title: string; quote: string; speaker: string; role: string; episodeId: string }
  takeaways: Takeaway[]
  contradictions: string[]
  mentions: { people: string[]; companies: string[] }
  questions: string[]
  sourceEpisodeIds: string[]
}

