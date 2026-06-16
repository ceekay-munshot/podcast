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

/** A concrete, actionable idea pitched in an episode — an investment/stock pick,
 *  a trade, a macro call, or a bold specific prediction — with the thesis behind
 *  it. The unit that lets the weekly surface "what was actually pitched" instead
 *  of dissolving it into generic themes. */
export interface Idea {
  /** The specific call, naming the instrument/company/action — e.g. "Long Uber (UBER)",
   *  "Short commercial real estate", "Fed cuts twice in 2026". */
  idea: string
  /** Who pitched it (speaker), or "—" when unattributed. */
  proponent: string
  /** The 2-4 key supporting thesis points, each a concrete clause. */
  thesis: string[]
  /** Optional coarse tag driving a subtle badge in the UI. */
  kind?: 'stock' | 'trade' | 'macro' | 'prediction'
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
  /** Timestamped highlights in timeline order; the `key` ones are the headline takeaways. */
  highlights: Highlight[]
  qa: QAItem[]
  /** Concrete ideas pitched in the episode (stock/macro/trade calls + thesis).
   *  Optional: empty/absent when the episode pitches nothing specific, and older
   *  cached summaries predate the field. */
  ideas?: Idea[]
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

/** A pitched idea as it appears in the weekly digest — the episode `Idea` plus a
 *  link back to the source episode (the show is implied by its parent digest). */
export interface WeeklyIdea extends Idea {
  episodeId: string
}

/** One show's slice of the week — the per-show mini-digest that is the weekly's
 *  primary organizing principle: what this show pitched, concluded, and left open. */
export interface WeeklyShowDigest {
  show: string
  podcastId: string
  episodeIds: string[]
  episodeCount: number
  ideas: WeeklyIdea[]
  takeaways: Takeaway[]
  questions: string[]
}

export interface WeeklySummary {
  id: string
  rangeLabel: string // "May 19 – May 25, 2026"
  episodeCount: number
  readMinutes: number
  /** "This week in summary" prose. */
  overview: string[]
  /** The week organized by show — the primary body. Each show is a mini-digest. */
  shows: WeeklyShowDigest[]
  topThemes: { label: string; momentum: number }[]
  /** "What was actually interesting" — a curated moment: a headline + the insight. */
  interesting: { title: string; quote: string; speaker: string; role: string; episodeId: string }
  /** Cross-show fallback takeaways (rendering is per-show via `shows`; kept for the
   *  deterministic/no-key path and older consumers). */
  takeaways: Takeaway[]
  contradictions: string[]
  mentions: { people: string[]; companies: string[] }
  questions: string[]
  sourceEpisodeIds: string[]
}

