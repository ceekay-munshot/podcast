import type { EpisodeTone, Highlight, Idea, QAItem, Summary, TranscriptSegment } from '../src/lib/types'
import { stableHash } from '../src/lib/hash'
import { transcribeEpisode } from './transcribe'
import { SUMMARY_REVISION, sharedSummaryKey, type SummaryStore } from './summaryStore'

// ─────────────────────────────────────────────────────────────────────────────
// AI summarization — runtime-agnostic (Vite dev middleware + Cloudflare Pages
// Function). Builds the app's structured Summary from the best available source:
// a real transcript (via the transcription provider chain) when one exists, else
// the publisher's show-notes. Provider-agnostic for the LLM: OpenAI if an OpenAI
// key is supplied, else Anthropic. Forced tool/function calling guarantees valid
// structured JSON. Keys are passed in by the caller (from env) — never hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

export interface SummarizeInput {
  /** Stable episode id — the shared cache key. When present, the result is reused
   *  across all users; when absent (e.g. the weekly roundup) the work is not shared. */
  id?: string
  title: string
  show: string
  notes?: string
  transcriptUrl?: string
  audioUrl?: string
  /** Skip the cache READS (shared store + in-process) and recompute from scratch,
   *  still writing the fresh result back. Powers the "Refresh" button so a shipped
   *  format/prompt change can replace a stale cached summary. */
  force?: boolean
}

export interface SummarizeConfig {
  openaiKey?: string
  anthropicKey?: string
  /** Optional model override; otherwise a sensible per-provider default is used. */
  model?: string
  // Transcription providers (threaded to the transcribe chain):
  deepgramKey?: string // URL-based, handles long episodes
  deepgramModel?: string
  groqKey?: string // free-tier Whisper (short episodes)
  /** Shared, persistent summary store (KV in prod, filesystem in dev). When set,
   *  a processed summary is reused across all users instead of recomputed. */
  store?: SummaryStore
}

/** What /api/summary returns: the one-page summary PLUS the full transcript it was
 *  built from (so the Transcript tab can render the real thing), when one exists. */
export interface SummarizeResult {
  summary: Summary
  transcript: TranscriptSegment[]
  transcriptSource?: 'feed' | 'groq' | 'deepgram'
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synthesis: {
      type: 'array',
      items: { type: 'string' },
      description: '3-4 substantive plain-text paragraphs that go beyond the headline. Lead with the central argument, then develop it with the SPECIFICS that make it credible — the concrete claims, real numbers, named companies/people, and the actual mechanism or causal chain behind each point. Capture the genuine tension or disagreement where speakers diverge (the bull case vs the bear case, what is contested, what is uncertain), and surface the non-obvious, second-order insight a sharp listener takes away — not the obvious summary anyone could write from the title. Avoid generic filler ("the market is maturing", "X is seeing significant growth"); every sentence must carry specific, episode-grounded content. Emphasise at most ~3 SHORT key phrases (2-5 words each) by wrapping each in matched **double asterisks** — never bold whole sentences or clauses, and always pair every ** you open with a closing **.',
    },
    qa: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
      description:
        'COMPREHENSIVE coverage of the substantive questions this episode raises and answers — capture EVERY distinct one, not a fixed number. A dense 40-60 minute episode typically yields 6-12; include as many as the material genuinely supports, roughly in the order the episode addresses them, and never drop a real question to hit a target. Exclude only trivial banter, logistics, and ad reads. Phrase each question as a complete, self-contained sentence that names its specific subject — someone who never heard the episode should understand exactly what is being asked (avoid vague stems like "What is the main focus?"). Each answer is a dense, self-explanatory paragraph of 2-4 full sentences that completely answers the question using the concrete specifics from the material — names, numbers, mechanisms, and the reasoning behind them — so it stands on its own without the audio. Draw every detail from the source; never pad or speculate to fill space.',
    },
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          idea: {
            type: 'string',
            description:
              'The specific, actionable call in a few words, naming the concrete instrument/company/action — e.g. "Long Uber (UBER)", "Short commercial real estate", "Buy 2-year Treasuries", "Fed cuts twice in 2026". Always name the ticker/company/asset when stated.',
          },
          proponent: { type: 'string', description: 'Who pitched/made the call (speaker name). Use "—" only if genuinely unattributed.' },
          thesis: {
            type: 'array',
            items: { type: 'string' },
            description: 'The 2-4 KEY supporting points actually given for the call — each a concrete, specific clause (the reason, the catalyst, the number), not a restatement of the idea.',
          },
          kind: { type: 'string', enum: ['stock', 'trade', 'macro', 'prediction'], description: 'Coarse category: a single-name equity pick (stock), a non-equity trade (trade), a macro/rates/economy call (macro), or a bold dated forecast (prediction).' },
        },
        required: ['idea', 'proponent', 'thesis'],
      },
      description:
        'Every CONCRETE, ACTIONABLE idea pitched in the episode — investment/stock picks (with ticker/company), trades, macro calls, or bold specific predictions — each with who pitched it and its key thesis. Capture EACH distinct call, not a summary of them; shows with an explicit pitch segment (e.g. All-In stock picks) must yield one entry per pick. Return an EMPTY array when the episode makes no specific, actionable call — do NOT lower the bar to fill it with vague opinions ("AI is overhyped") or generic observations. Never invent a pitch that was not actually made.',
    },
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          timestamp: { type: 'string', description: 'mm:ss if known, otherwise "—"' },
          detail: { type: 'string' },
          key: { type: 'boolean', description: 'true ONLY for the 4-6 most important items — the headline takeaways of the episode.' },
        },
        required: ['title', 'timestamp', 'detail', 'key'],
      },
      description: 'COMPREHENSIVE coverage of the episode\'s highlights — the beats a sharp listener would revisit: bold claims, specific predictions or numbers, sharp disagreements, surprising data, memorable anecdotes, or pivotal turns in the conversation. Capture EVERY such beat, not a fixed number; a dense 40-60 minute episode typically yields 7-12, spread across the whole episode (early, middle, AND late) rather than clustered at the opening. Each title names the specific beat; each detail is 1-2 concrete sentences stating what was actually said (the specific claim, number, or exchange, naming who said it when notable) and why it matters — never generic filler like "this highlights a key shift". Then set key=true on ONLY the 4-6 most important, non-obvious items — the headline takeaways a busy reader must not miss — and key=false on the rest.',
    },
    tone: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overall: {
          type: 'string',
          enum: ['positive', 'cautious', 'mixed', 'neutral'],
          description: 'The NET tone of the episode, judged from what is actually said: positive (the conversation leans optimistic/bullish), cautious (it leans wary/bearish/concerned), mixed (real sentiment on both sides with no clear net lean), neutral (largely descriptive, little evaluative charge).',
        },
        rationale: {
          type: 'string',
          description: 'ONE sentence (~140-220 chars) explaining the net read, grounded in specifics the episode actually discusses — not a generic gloss.',
        },
        aspects: {
          type: 'array',
          minItems: 3,
          maxItems: 6,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              subject: { type: 'string', description: 'A real company / person / topic the episode genuinely discusses, as a short display name of ~1-4 words (e.g. "SpaceX", "secondary markets", "retail investors").' },
              sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'], description: 'The sentiment the episode expresses TOWARD this subject.' },
              note: { type: 'string', description: 'One short clause/sentence giving the specific reason for that sentiment, drawn from the material.' },
            },
            required: ['subject', 'sentiment', 'note'],
          },
          description: '3-6 entries naming the specific subjects the episode is positive/negative/neutral ABOUT — the "about what" behind the net read. Subjects must be things the episode genuinely discusses; never invent sentiment that was not expressed.',
        },
      },
      required: ['overall', 'rationale', 'aspects'],
    },
  },
  required: ['synthesis', 'qa', 'ideas', 'highlights', 'tone'],
}

const SYSTEM_BASE =
  'You are Munshot, an AI that writes sharp one-page intelligence summaries of podcast episodes for busy operators and investors. Produce the summary by calling the emit_summary tool/function. Rules:\n- Base everything ONLY on the provided material. Do NOT invent facts, quotes, names, or numbers.\n- synthesis: go deeper than the headline. Lead with the central argument, then develop it with the specifics that make it credible — concrete claims, real numbers, named companies/people, and the mechanism or causal chain behind each point. Capture the genuine tension or disagreement between speakers (the bull case vs the bear case, what is contested, what is still uncertain), and surface the non-obvious, second-order insight a sharp listener takes away — not a generic recap anyone could write from the title. Every sentence must carry specific, episode-grounded content; cut filler like "the market is maturing" or "X is seeing significant growth". Emphasise only a FEW short key phrases (2-5 words each, at most ~3 per summary) by wrapping each in matched **double asterisks** — never bold whole sentences or clauses, and always close every ** you open.\n- qa: be EXHAUSTIVE — capture every substantive question the episode actually raises and answers, in the order it addresses them, not a curated handful. Exclude only trivial banter, logistics, and ad reads. Make every question specific and self-contained (it should read clearly on its own), and every answer thorough, concrete, and fully understandable without the audio — 2-4 real sentences that explain the "why" and the specifics, never one terse line, but never padded or invented either.\n- ideas: capture every CONCRETE, ACTIONABLE call the episode makes — investment/stock picks (name the ticker/company), trades, macro calls, or bold specific predictions — as a discrete item with who pitched it and the 2-4 key thesis points behind it. Shows with a dedicated pitch segment (e.g. All-In stock picks) must yield one entry per pick. Return an EMPTY list when nothing specific is pitched — never lower the bar to fill it with vague opinions or generic observations, and never invent a call that was not made.\n- highlights: be thorough — surface every genuinely interesting beat the episode delivers (bold claims, specific predictions or numbers, sharp disagreements, surprising data, memorable anecdotes), not just one or two, with each detail concrete about what was actually said — never a generic gloss. Then flag the 4-6 most important, non-obvious ones with key=true — the headline takeaways; a reader who only sees those must walk away with the episode\'s core. Never flag more than half the list.\n- tone: read the episode\'s sentiment from what is ACTUALLY said — never invent a feeling that was not expressed. Set "overall" to the net lean, write "rationale" as ONE grounded sentence, and list 3-6 "aspects": the specific companies/people/topics the episode is positive, negative, or neutral ABOUT, each with a short subject (1-4 words) and a one-clause "note" giving the real reason. Only include subjects the episode genuinely discusses.'

const SYSTEM_TRANSCRIPT = `${SYSTEM_BASE}\n- You have the FULL transcript, annotated with [mm:ss] markers. Ground everything in what was actually said.\n- For "highlights", draw them from DIFFERENT parts of the episode — early, middle, and late, not all from the opening — and set each timestamp to the real [mm:ss] of the nearest marker. Never use 0:00.`
const SYSTEM_NOTES = `${SYSTEM_BASE}\n- You only have the publisher's show-notes (not the audio). If they are thin or promotional, keep the summary brief and high-level rather than fabricating. Use "—" for highlight timestamps.`

function buildPrompt(input: SummarizeInput, transcript: string | null): { system: string; user: string } {
  if (transcript) {
    // ~120k chars ≈ 30k tokens — covers ~2 hr in full; trivial cost on gpt-4o-mini.
    return { system: SYSTEM_TRANSCRIPT, user: `Show: ${input.show}\nEpisode: ${input.title}\n\nTranscript:\n${transcript.slice(0, 120000)}` }
  }
  return { system: SYSTEM_NOTES, user: `Show: ${input.show}\nEpisode: ${input.title}\n\nShow notes:\n${input.notes || '(no show-notes provided)'}` }
}

// server/ is NOT type-checked by `npm run build` (tsconfig includes only src/), and
// the LLM output is untrusted, so validate tone at runtime: drop the whole object if
// the shape is off, and silently discard any malformed aspect rather than crashing.
const TONE_OVERALLS = new Set(['positive', 'cautious', 'mixed', 'neutral'])
const TONE_SENTIMENTS = new Set(['positive', 'negative', 'neutral'])

// What an emit_summary call returns before normalization (no ids yet, loose fields).
type RawSummary = {
  synthesis?: string[]
  qa?: QAItem[]
  ideas?: unknown
  highlights?: Array<{ title: string; timestamp: string; detail: string; key?: boolean }>
  tone?: unknown
}

const IDEA_KINDS = new Set(['stock', 'trade', 'macro', 'prediction'])

// Validate the LLM's `ideas` at runtime (same untrusted-output discipline as tone):
// drop any entry without a usable headline, coerce a missing proponent to "—", keep
// only string thesis points (max 4), and accept `kind` only from the known set.
function normalizeIdeas(raw: RawSummary | undefined): Idea[] {
  const list = raw?.ideas
  if (!Array.isArray(list)) return []
  const out: Idea[] = []
  for (const it of list as Array<{ idea?: unknown; proponent?: unknown; thesis?: unknown; kind?: unknown }>) {
    if (!it || typeof it !== 'object') continue
    const idea = typeof it.idea === 'string' ? it.idea.trim() : ''
    if (!idea) continue // an idea with no headline is unusable
    const thesis = Array.isArray(it.thesis)
      ? (it.thesis.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => t.trim()).slice(0, 4))
      : []
    const proponent = typeof it.proponent === 'string' && it.proponent.trim() ? it.proponent.trim() : '—'
    const kind = typeof it.kind === 'string' && IDEA_KINDS.has(it.kind) ? (it.kind as Idea['kind']) : undefined
    out.push({ idea, proponent, thesis, ...(kind ? { kind } : {}) })
  }
  return out
}

function normalizeTone(raw: RawSummary | undefined): EpisodeTone | undefined {
  const t = raw?.tone as unknown as { overall?: unknown; rationale?: unknown; aspects?: unknown } | undefined
  if (!t || typeof t !== 'object') return undefined
  if (typeof t.overall !== 'string' || !TONE_OVERALLS.has(t.overall)) return undefined
  if (typeof t.rationale !== 'string' || !Array.isArray(t.aspects)) return undefined
  const aspects = (t.aspects as Array<{ subject?: unknown; sentiment?: unknown; note?: unknown }>)
    .filter((a) => a && typeof a.subject === 'string' && typeof a.sentiment === 'string' && TONE_SENTIMENTS.has(a.sentiment) && typeof a.note === 'string')
    .slice(0, 6)
    .map((a) => ({ subject: a.subject as string, sentiment: a.sentiment as EpisodeTone['aspects'][number]['sentiment'], note: a.note as string }))
  return { overall: t.overall as EpisodeTone['overall'], rationale: t.rationale, aspects }
}

function normalize(raw: RawSummary | undefined): Summary {
  const r = raw ?? {}
  const tone = normalizeTone(raw)
  const ideas = normalizeIdeas(raw)
  // Normalize each highlight timestamp to a clean "m:ss" (the model sometimes copies
  // the bracketed transcript marker, e.g. "[12:34]"), sort chronologically (it can
  // emit them out of order), then assign stable ids in display order. Clean timestamps
  // are what lets buildTranscript anchor each highlight to its transcript row.
  const highlights: Highlight[] = (r.highlights ?? [])
    .map((h) => ({ ...h, timestamp: cleanClock(h.timestamp), key: !!h.key }))
    .sort((a, b) => (parseClock(a.timestamp) ?? Number.POSITIVE_INFINITY) - (parseClock(b.timestamp) ?? Number.POSITIVE_INFINITY))
    .map((h, i) => ({ ...h, id: `gen-${i}` }))
  return {
    synthesis: r.synthesis ?? [],
    highlights,
    qa: r.qa ?? [],
    ...(ideas.length ? { ideas } : {}),
    ...(tone ? { tone } : {}),
  }
}

// Clean a highlight timestamp to a display-ready "m:ss" / "h:mm:ss", or "—" if unparseable.
function cleanClock(ts: string): string {
  const sec = parseClock(ts)
  return sec == null ? '—' : mmss(sec)
}

// ── Transcript display: group raw provider segments into readable rows, and
//    wire each highlight to the nearest row for the Highlights ↔ jump UX ──────

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// Parse a clock string the LLM cites for a highlight ("mm:ss", "h:mm:ss", and even
// bracketed forms like "[12:34]") to seconds. Strips any non-digit/colon noise first
// so a stray marker bracket can't break chronological sorting or transcript anchoring.
function parseClock(ts: string): number | null {
  const parts = (ts || '').replace(/[^\d:]/g, '').split(':')
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p === '')) return null
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null
  return parts.length === 3 ? nums[0] * 3600 + nums[1] * 60 + nums[2] : nums[0] * 60 + nums[1]
}

type RawSeg = { start: number; text: string; speaker?: number }

// Some feeds embed speaker labels inline ("Speaker 1: … Speaker 2: …") instead of
// as diarization metadata. Split those into one piece per turn with the speaker
// extracted, so the transcript reads as clean dialogue rather than run-on blocks.
// (Deepgram/Groq text has no such labels, so those pass through untouched.)
function expandInlineSpeakers(raw: RawSeg[]): RawSeg[] {
  const out: RawSeg[] = []
  for (const s of raw) {
    const parts = s.text.split(/\bSpeakers?\s+(\d+):\s*/i) // [lead, num, text, num, text, …]
    if (parts.length === 1) {
      out.push(s)
      continue
    }
    if (parts[0].trim()) out.push({ start: s.start, text: parts[0].trim(), speaker: s.speaker })
    for (let i = 1; i < parts.length; i += 2) {
      const num = Number(parts[i])
      const text = (parts[i + 1] ?? '').trim()
      if (text) out.push({ start: s.start, text, speaker: Number.isFinite(num) ? num - 1 : s.speaker })
    }
  }
  return out
}

// Merge raw cues/utterances into paragraph-sized rows: break on speaker change,
// otherwise accumulate up to ~maxChars so the transcript reads in natural blocks.
function groupSegments(raw: RawSeg[], maxChars = 650): RawSeg[] {
  const out: RawSeg[] = []
  for (const s of raw) {
    const text = s.text.trim()
    if (!text) continue
    const last = out[out.length - 1]
    if (last && last.speaker === s.speaker && last.text.length + text.length + 1 <= maxChars) {
      last.text = `${last.text} ${text}`
    } else {
      out.push({ start: s.start, text, speaker: s.speaker })
    }
  }
  return out
}

function buildTranscript(raw: RawSeg[], highlights: Highlight[]): { segments: TranscriptSegment[]; highlights: Highlight[] } {
  const grouped = groupSegments(expandInlineSpeakers(raw))
  const segments: TranscriptSegment[] = grouped.map((g, i) => ({
    id: `t${i}`,
    speaker: g.speaker != null ? `Speaker ${g.speaker + 1}` : '',
    role: (g.speaker ?? 0) === 0 ? 'host' : 'guest',
    timestamp: mmss(g.start),
    text: g.text,
  }))

  // Anchor each highlight to the row whose start time is closest to its timestamp,
  // so clicking one jumps to the right place and the row glows.
  const linked = highlights.map((h) => {
    const sec = parseClock(h.timestamp)
    if (sec == null || !grouped.length) return h
    let best = 0
    let bestDelta = Infinity
    grouped.forEach((g, i) => {
      const d = Math.abs(g.start - sec)
      if (d < bestDelta) {
        bestDelta = d
        best = i
      }
    })
    segments[best].highlight = { refId: h.id, quote: '', label: h.title }
    return { ...h, segmentId: segments[best].id }
  })

  return { segments, highlights: linked }
}

// In-memory L1 cache: a within-process fast path (warm worker / dev server). The
// shared store below is the cross-user, cross-instance L2. SUMMARY_REVISION lives
// in summaryStore.ts now (it keys both caches).
const cache = new Map<string, SummarizeResult>()

export async function summarizeEpisode(input: SummarizeInput, config: SummarizeConfig): Promise<SummarizeResult> {
  const provider = config.openaiKey ? 'openai' : config.anthropicKey ? 'anthropic' : null
  if (!provider) throw new Error('no_api_key')
  const model = config.model || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL)

  // Shared, persistent cache (KV in prod, filesystem in dev), keyed by the stable
  // episode id: the FIRST user to open an episode pays the transcription + LLM
  // cost, and every user after — across browsers and worker instances — reuses
  // it. Checked before transcription so a hit skips that cost too. Only engaged
  // when an id is supplied; the weekly roundup posts no id and is never shared.
  const sharedKey = input.id ? sharedSummaryKey(input.id) : null
  if (!input.force && sharedKey && config.store) {
    const shared = await config.store.get(sharedKey)
    if (shared) return shared
  }

  // Best available source: real transcript (provider chain) > show-notes.
  const transcript = await transcribeEpisode(
    { title: input.title, transcriptUrl: input.transcriptUrl, audioUrl: input.audioUrl },
    { deepgramKey: config.deepgramKey, deepgramModel: config.deepgramModel, groqKey: config.groqKey },
  )
  const prompt = buildPrompt(input, transcript?.text ?? null)

  // Key the in-process L1 cache by the STABLE id (globally unique), not the title:
  // two different episodes that share a title ("Mailbag", "2024 Predictions", and
  // across shows generally) would otherwise collide here and serve each other's
  // summary — and since L1 is checked after the per-id L2 store, an L1 collision
  // shadows the correct L2 entry. The weekly roundup passes a content-derived
  // `weekly:<hash>` id (so it's shared like episodes); any truly id-less call falls
  // back to a hash of its show+notes so distinct inputs still get distinct slots.
  const idPart = input.id ?? `n:${stableHash(`${input.show} ${input.notes ?? ''}`)}`
  const cacheKey = `${provider}:${model}:${transcript ? 't' : 'n'}:r${SUMMARY_REVISION}::${idPart}`
  const hit = input.force ? undefined : cache.get(cacheKey)
  if (hit) return hit

  const summary =
    provider === 'openai'
      ? await viaOpenAI(prompt, config.openaiKey as string, model)
      : await viaAnthropic(prompt, config.anthropicKey as string, model)

  // Bundle the real transcript (the same one the summary was built from) so the
  // Transcript tab renders it — no second transcription, no extra cost.
  let result: SummarizeResult
  if (transcript && transcript.segments.length) {
    const built = buildTranscript(transcript.segments, summary.highlights)
    result = { summary: { ...summary, highlights: built.highlights }, transcript: built.segments, transcriptSource: transcript.source }
  } else {
    result = { summary, transcript: [] }
  }

  if (cache.size > 300) cache.clear()
  cache.set(cacheKey, result)
  // Persist to the shared store so other users / worker instances reuse this work
  // instead of paying for it again (best-effort; never blocks the response).
  if (sharedKey && config.store) await config.store.put(sharedKey, result)
  return result
}

// ── OpenAI (Chat Completions + forced function call) ─────────────────────────
async function viaOpenAI(prompt: { system: string; user: string }, apiKey: string, model: string): Promise<Summary> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // 8192 leaves room for richer synthesis + comprehensive Q&A. Keep it under
      // ~16K: this is a non-streaming raw fetch, and larger outputs risk HTTP timeouts.
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      tools: [{ type: 'function', function: { name: 'emit_summary', description: 'Emit the structured one-page summary.', parameters: SCHEMA } }],
      tool_choice: { type: 'function', function: { name: 'emit_summary' } },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`openai ${res.status}: ${body.slice(0, 200)}`)
  }
  const data: { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> } = await res.json()
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (!args) throw new Error('openai: no function call in response')
  return normalize(JSON.parse(args) as RawSummary)
}

// ── Anthropic (Messages API + forced tool use) ───────────────────────────────
async function viaAnthropic(prompt: { system: string; user: string }, apiKey: string, model: string): Promise<Summary> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      // Room for comprehensive Q&A; <~16K keeps this non-streaming request under HTTP timeouts.
      max_tokens: 8192,
      system: prompt.system,
      tools: [{ name: 'emit_summary', description: 'Emit the structured one-page summary.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'emit_summary' },
      messages: [{ role: 'user', content: prompt.user }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 200)}`)
  }
  const data: { content?: Array<{ type: string; name?: string; input?: unknown }> } = await res.json()
  const toolUse = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'emit_summary')
  if (!toolUse?.input) throw new Error('anthropic: no emit_summary tool_use in response')
  return normalize(toolUse.input as RawSummary)
}
