import type { Summary } from '../src/lib/types'
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

const SYSTEM_TRANSCRIPT = `${SYSTEM_BASE}\n- You have the FULL transcript of the episode — ground the summary in what was actually said, and give real mm:ss timestamps for moments where you can infer them.`
const SYSTEM_NOTES = `${SYSTEM_BASE}\n- You only have the publisher's show-notes (not the audio). If they are thin or promotional, keep the summary brief and high-level rather than fabricating. Use "—" for moment timestamps.`

function buildPrompt(input: SummarizeInput, transcript: string | null): { system: string; user: string } {
  if (transcript) {
    return { system: SYSTEM_TRANSCRIPT, user: `Show: ${input.show}\nEpisode: ${input.title}\n\nTranscript:\n${transcript.slice(0, 48000)}` }
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

const cache = new Map<string, Summary>()

export async function summarizeEpisode(input: SummarizeInput, config: SummarizeConfig): Promise<Summary> {
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

  if (cache.size > 300) cache.clear()
  cache.set(cacheKey, summary)
  return summary
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
