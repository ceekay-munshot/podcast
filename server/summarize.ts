import type { Highlight, QAItem, Summary, TranscriptSegment } from '../src/lib/types'
import { transcribeEpisode } from './transcribe'

// ─────────────────────────────────────────────────────────────────────────────
// AI summarization — runtime-agnostic (Vite dev middleware + Cloudflare Pages
// Function). Builds the app's structured Summary from the best available source:
// a real transcript (via the transcription provider chain) when one exists, else
// the publisher's show-notes. Provider-agnostic for the LLM: OpenAI if an OpenAI
// key is supplied, else Anthropic. Forced tool/function calling guarantees valid
// structured JSON. Keys are passed in by the caller (from env) — never hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

export interface SummarizeInput {
  title: string
  show: string
  notes?: string
  transcriptUrl?: string
  audioUrl?: string
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

// Two focused schemas for two focused passes (see SYSTEM_* below). On smaller
// models a single combined call trades narrative depth for list breadth; splitting
// "narrative" (synthesis) from "extraction" (Q&A + highlights) lets each run with
// full attention and its own token budget.
const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synthesis: {
      type: 'array',
      items: { type: 'string' },
      description: '3-4 substantive plain-text paragraphs that go beyond the headline. Lead with the central argument, then develop it with the SPECIFICS that make it credible — the concrete claims, real numbers, named companies/people, and the actual mechanism or causal chain behind each point. Capture the genuine tension or disagreement where speakers diverge (the bull case vs the bear case, what is contested, what is uncertain), and surface the non-obvious, second-order insight a sharp listener takes away — not the obvious summary anyone could write from the title. Avoid generic filler ("the market is maturing", "X is seeing significant growth"); every sentence must carry specific, episode-grounded content. Emphasise at most ~3 SHORT key phrases (2-5 words each) by wrapping each in matched **double asterisks** — never bold whole sentences or clauses, and always pair every ** you open with a closing **.',
    },
  },
  required: ['synthesis'],
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    qa: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
      description:
        'EXHAUSTIVE coverage — capture EVERY substantive question the episode raises and answers, in the order it addresses them; a full 40-60 minute episode usually yields 8-14, so never settle for a handful. Exclude only trivial banter, logistics, and ad reads. Phrase each question as a complete, self-contained sentence that names its specific subject — someone who never heard the episode should understand exactly what is being asked (avoid vague stems like "What is the main focus?"). Each answer is a dense, self-explanatory paragraph of 2-4 full sentences using the concrete specifics from the material — names, numbers, mechanisms, and the reasoning behind them — so it stands on its own without the audio. Never pad or speculate to fill space.',
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
      description: 'EXHAUSTIVE coverage of the episode\'s highlights — the beats a sharp listener would revisit: bold claims, specific predictions or numbers, sharp disagreements, surprising data, memorable anecdotes, or pivotal turns. Capture EVERY such beat; a full 40-60 minute episode usually yields 7-12, spread EVENLY across the whole timeline (early, middle, AND late), never clustered at the opening. Each title names the specific beat; each detail is 1-2 concrete sentences stating what was actually said (the specific claim, number, or exchange, naming who said it when notable) and why it matters — never generic filler like "this highlights a key shift". Then set key=true on ONLY the 4-6 most important, non-obvious items — the headline takeaways a busy reader must not miss — and key=false on the rest.',
    },
  },
  required: ['qa', 'highlights'],
}

const SYSTEM_NARRATIVE =
  'You are Munshot, writing the NARRATIVE half of a sharp one-page intelligence brief for busy operators and investors — a rich synthesis. It must read like real analysis, not a recap. Produce it by calling the emit tool/function. Rules:\n- Base everything ONLY on the provided material. Do NOT invent facts, quotes, names, or numbers.\n- synthesis: lead with the central argument, then develop it with the specifics that make it credible (real numbers, named people/companies, the mechanism behind each point), the genuine bull/bear tension between speakers, and the non-obvious second-order insight. Cut generic filler like "the market is maturing". Emphasise at most ~3 short key phrases (2-5 words each) in matched **double asterisks**, always closing every ** you open.'

const SYSTEM_EXTRACTION =
  'You are Munshot, EXTRACTING the complete Q&A and the timeline highlights from a podcast episode for busy operators and investors. Produce it by calling the emit tool/function. Rules:\n- Base everything ONLY on the provided material. Do NOT invent.\n- Work through the ENTIRE source chronologically, start to finish. Give the middle and END the SAME attention as the opening — do not front-load; many of the best questions and highlights come later.\n- Err toward inclusion: when unsure whether a question or highlight qualifies, INCLUDE it. Missing a real one is worse than a borderline one.\n- qa: every substantive question, self-contained and naming its subject, each with a dense 2-4 sentence answer.\n- highlights: every genuinely interesting beat, spread evenly across the timeline, each with a concrete detail and a real timestamp. Then flag the 4-6 most important, non-obvious ones with key=true — the headline takeaways of the episode; a reader who only sees those must walk away with the episode\'s core. Never flag more than half the list.\nCALIBRATION (form only — never copy this content):\n- GOOD question: "Why does the guest expect Acme\'s usage-based pricing to compress margins through 2026?" BAD: "What about pricing?"\n- GOOD highlight detail: "A guest pegs data-center power demand at 3x the grid by 2030 — a number that reframes the capex debate." BAD: "This highlights an important industry trend."'

// Appended to both passes so each knows what source it is working from.
const SRC_TRANSCRIPT = '\n- You have the FULL transcript, annotated with [mm:ss] markers. Ground every claim in what was actually said; use the real markers for any timestamps (never 0:00).'
const SRC_NOTES = "\n- You only have the publisher's show-notes (not the audio). If they are thin or promotional, stay high-level rather than fabricating, and use \"—\" for highlight timestamps."

function buildUser(input: SummarizeInput, transcript: string | null): string {
  if (transcript) {
    // ~120k chars ≈ 30k tokens — covers ~2 hr in full; trivial cost on gpt-4o-mini.
    return `Show: ${input.show}\nEpisode: ${input.title}\n\nTranscript:\n${transcript.slice(0, 120000)}`
  }
  return `Show: ${input.show}\nEpisode: ${input.title}\n\nShow notes:\n${input.notes || '(no show-notes provided)'}`
}

// What the two emit calls return before normalization (no ids yet, loose fields).
type RawSummary = {
  synthesis?: string[]
  qa?: QAItem[]
  highlights?: Array<{ title: string; timestamp: string; detail: string; key?: boolean }>
}

function normalize(raw: RawSummary): Summary {
  // Normalize each highlight timestamp to a clean "m:ss" (the model sometimes copies
  // the bracketed transcript marker, e.g. "[12:34]"), sort chronologically (it can
  // emit them out of order), then assign stable ids in display order. Clean timestamps
  // are what lets buildTranscript anchor each highlight to its transcript row.
  const highlights: Highlight[] = (raw.highlights ?? [])
    .map((h) => ({ ...h, timestamp: cleanClock(h.timestamp), key: !!h.key }))
    .sort((a, b) => (parseClock(a.timestamp) ?? Number.POSITIVE_INFINITY) - (parseClock(b.timestamp) ?? Number.POSITIVE_INFINITY))
    .map((h, i) => ({ ...h, id: `gen-${i}` }))
  return {
    synthesis: raw.synthesis ?? [],
    highlights,
    qa: raw.qa ?? [],
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

// Bump when the summary prompt/schema changes, so a warm worker (whose in-memory
// cache can outlive a deploy) never serves a summary written by the previous prompt.
const SUMMARY_REVISION = 5
const cache = new Map<string, SummarizeResult>()

export async function summarizeEpisode(input: SummarizeInput, config: SummarizeConfig): Promise<SummarizeResult> {
  const provider = config.openaiKey ? 'openai' : config.anthropicKey ? 'anthropic' : null
  if (!provider) throw new Error('no_api_key')
  const model = config.model || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL)

  // Best available source: real transcript (provider chain) > show-notes.
  const transcript = await transcribeEpisode(
    { title: input.title, transcriptUrl: input.transcriptUrl, audioUrl: input.audioUrl },
    { deepgramKey: config.deepgramKey, deepgramModel: config.deepgramModel, groqKey: config.groqKey },
  )
  const user = buildUser(input, transcript?.text ?? null)
  const src = transcript ? SRC_TRANSCRIPT : SRC_NOTES

  const cacheKey = `${provider}:${model}:${transcript ? 't' : 'n'}:r${SUMMARY_REVISION}::${input.title}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  // Two focused passes IN PARALLEL: narrative (synthesis) and extraction (Q&A +
  // highlights). Each gets full attention and its own token budget, which beats
  // one combined call that trades depth for breadth on smaller models.
  const apiKey = (provider === 'openai' ? config.openaiKey : config.anthropicKey) as string
  const emit = (system: string, schema: object) =>
    provider === 'openai' ? viaOpenAI(system, user, schema, apiKey, model) : viaAnthropic(system, user, schema, apiKey, model)
  const [narrative, extraction] = await Promise.all([
    emit(SYSTEM_NARRATIVE + src, NARRATIVE_SCHEMA),
    emit(SYSTEM_EXTRACTION + src, EXTRACTION_SCHEMA),
  ])
  const summary = normalize({ ...narrative, ...extraction })

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
  return result
}

// ── OpenAI (Chat Completions + forced function call) ─────────────────────────
async function viaOpenAI(system: string, user: string, schema: object, apiKey: string, model: string): Promise<RawSummary> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      // Slightly low temperature for consistent instruction-following + completeness on
      // the small model (honors "be exhaustive" more reliably than the 1.0 default).
      // Not set on the Anthropic path — Opus 4.x rejects sampling params.
      temperature: 0.4,
      // 8192 is ample for one focused pass; under ~16K so this non-streaming request can't hit HTTP timeouts.
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tools: [{ type: 'function', function: { name: 'emit', description: 'Emit the structured result.', parameters: schema } }],
      tool_choice: { type: 'function', function: { name: 'emit' } },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`openai ${res.status}: ${body.slice(0, 200)}`)
  }
  const data: { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> } = await res.json()
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (!args) throw new Error('openai: no function call in response')
  return JSON.parse(args) as RawSummary
}

// ── Anthropic (Messages API + forced tool use) ───────────────────────────────
async function viaAnthropic(system: string, user: string, schema: object, apiKey: string, model: string): Promise<RawSummary> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      tools: [{ name: 'emit', description: 'Emit the structured result.', input_schema: schema }],
      tool_choice: { type: 'tool', name: 'emit' },
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 200)}`)
  }
  const data: { content?: Array<{ type: string; name?: string; input?: unknown }> } = await res.json()
  const toolUse = (data.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'emit')
  if (!toolUse?.input) throw new Error('anthropic: no emit tool_use in response')
  return toolUse.input as RawSummary
}
