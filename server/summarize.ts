import type { InterestingMoment, Summary, TranscriptSegment } from '../src/lib/types'
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

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    synthesis: {
      type: 'array',
      items: { type: 'string' },
      description: '2-3 tight plain-text paragraphs capturing the core argument and why it matters. Wrap the few most important phrases in **double asterisks** for emphasis.',
    },
    takeaways: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, detail: { type: 'string' } }, required: ['title', 'detail'] },
      description: '3-4 concrete, non-obvious takeaways.',
    },
    qa: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: { q: { type: 'string' }, a: { type: 'string' } }, required: ['q', 'a'] },
      description: '1-2 sharp questions the episode answers, with concise answers.',
    },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' }, timestamp: { type: 'string', description: 'mm:ss if known, otherwise "—"' }, whyItMatters: { type: 'string' } },
        required: ['title', 'timestamp', 'whyItMatters'],
      },
      description: '1-2 genuinely interesting moments.',
    },
  },
  required: ['synthesis', 'takeaways', 'qa', 'moments'],
}

const SYSTEM_BASE =
  'You are Munshot, an AI that writes sharp one-page intelligence summaries of podcast episodes for busy operators and investors. Produce the summary by calling the emit_summary tool/function. Rules:\n- Base everything ONLY on the provided material. Do NOT invent facts, quotes, names, or numbers.\n- synthesis: lead with the core argument; bold the few most important phrases with **double asterisks**.\n- Be concrete and non-obvious in takeaways.'

const SYSTEM_TRANSCRIPT = `${SYSTEM_BASE}\n- You have the FULL transcript, annotated with [mm:ss] markers. Ground everything in what was actually said.\n- For "moments", pick ones from DIFFERENT parts of the episode — early, middle, and late, not all from the opening — and set each timestamp to the real [mm:ss] of the nearest marker. Never use 0:00.`
const SYSTEM_NOTES = `${SYSTEM_BASE}\n- You only have the publisher's show-notes (not the audio). If they are thin or promotional, keep the summary brief and high-level rather than fabricating. Use "—" for moment timestamps.`

function buildPrompt(input: SummarizeInput, transcript: string | null): { system: string; user: string } {
  if (transcript) {
    // ~120k chars ≈ 30k tokens — covers ~2 hr in full; trivial cost on gpt-4o-mini.
    return { system: SYSTEM_TRANSCRIPT, user: `Show: ${input.show}\nEpisode: ${input.title}\n\nTranscript:\n${transcript.slice(0, 120000)}` }
  }
  return { system: SYSTEM_NOTES, user: `Show: ${input.show}\nEpisode: ${input.title}\n\nShow notes:\n${input.notes || '(no show-notes provided)'}` }
}

function normalize(raw: Partial<Summary> | undefined): Summary {
  const r = raw ?? {}
  return {
    synthesis: r.synthesis ?? [],
    takeaways: r.takeaways ?? [],
    qa: r.qa ?? [],
    moments: (r.moments ?? []).map((m, i) => ({ ...m, id: `gen-${i}` })),
  }
}

// ── Transcript display: group raw provider segments into readable rows, and
//    wire each summary "moment" to the nearest row for the Highlights ↔ jump UX ─

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// Parse a "mm:ss" / "h:mm:ss" clock string (as the LLM cites moments) to seconds.
function parseClock(ts: string): number | null {
  const parts = ts.trim().split(':')
  if (parts.length < 2 || parts.length > 3) return null
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

function buildTranscript(raw: RawSeg[], moments: InterestingMoment[]): { segments: TranscriptSegment[]; moments: InterestingMoment[] } {
  const grouped = groupSegments(expandInlineSpeakers(raw))
  const segments: TranscriptSegment[] = grouped.map((g, i) => ({
    id: `t${i}`,
    speaker: g.speaker != null ? `Speaker ${g.speaker + 1}` : '',
    role: (g.speaker ?? 0) === 0 ? 'host' : 'guest',
    timestamp: mmss(g.start),
    text: g.text,
  }))

  // Anchor each moment to the row whose start time is closest to its timestamp,
  // so clicking a Highlight jumps to the right place and the row glows.
  const linked = moments.map((m) => {
    const sec = parseClock(m.timestamp)
    if (sec == null || !grouped.length) return m
    let best = 0
    let bestDelta = Infinity
    grouped.forEach((g, i) => {
      const d = Math.abs(g.start - sec)
      if (d < bestDelta) {
        bestDelta = d
        best = i
      }
    })
    segments[best].highlight = { refId: m.id, quote: '', label: m.title }
    return { ...m, segmentId: segments[best].id }
  })

  return { segments, moments: linked }
}

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
  const prompt = buildPrompt(input, transcript?.text ?? null)

  const cacheKey = `${provider}:${model}:${transcript ? 't' : 'n'}::${input.title}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const summary =
    provider === 'openai'
      ? await viaOpenAI(prompt, config.openaiKey as string, model)
      : await viaAnthropic(prompt, config.anthropicKey as string, model)

  // Bundle the real transcript (the same one the summary was built from) so the
  // Transcript tab renders it — no second transcription, no extra cost.
  let result: SummarizeResult
  if (transcript && transcript.segments.length) {
    const built = buildTranscript(transcript.segments, summary.moments)
    result = { summary: { ...summary, moments: built.moments }, transcript: built.segments, transcriptSource: transcript.source }
  } else {
    result = { summary, transcript: [] }
  }

  if (cache.size > 300) cache.clear()
  cache.set(cacheKey, result)
  return result
}

// ── OpenAI (Chat Completions + forced function call) ─────────────────────────
async function viaOpenAI(prompt: { system: string; user: string }, apiKey: string, model: string): Promise<Summary> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: 2048,
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
  return normalize(JSON.parse(args) as Partial<Summary>)
}

// ── Anthropic (Messages API + forced tool use) ───────────────────────────────
async function viaAnthropic(prompt: { system: string; user: string }, apiKey: string, model: string): Promise<Summary> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
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
  return normalize(toolUse.input as Partial<Summary>)
}
