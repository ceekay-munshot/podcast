import type { Summary } from '../src/lib/types'

// ─────────────────────────────────────────────────────────────────────────────
// AI summarization — runtime-agnostic (Vite dev middleware + Cloudflare Pages
// Function). Turns an episode's publisher show-notes into the app's structured
// Summary. Provider-agnostic: uses OpenAI if an OpenAI key is supplied, else
// Anthropic. Both use forced tool/function calling so the response is always
// valid structured JSON. Keys are passed in by the caller (read from env) —
// never hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

export interface SummarizeInput {
  title: string
  show: string
  notes: string
}

export interface SummarizeConfig {
  openaiKey?: string
  anthropicKey?: string
  /** Optional model override; otherwise a sensible per-provider default is used. */
  model?: string
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8'

// Shared JSON Schema for the structured summary (used as OpenAI function
// parameters and as the Anthropic tool input_schema).
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
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' }, detail: { type: 'string' } },
        required: ['title', 'detail'],
      },
      description: '3-4 concrete, non-obvious takeaways.',
    },
    qa: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { q: { type: 'string' }, a: { type: 'string' } },
        required: ['q', 'a'],
      },
      description: '1-2 sharp questions the episode answers, with concise answers.',
    },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          timestamp: { type: 'string', description: 'mm:ss if known, otherwise "—"' },
          whyItMatters: { type: 'string' },
        },
        required: ['title', 'timestamp', 'whyItMatters'],
      },
      description: '1-2 genuinely interesting moments.',
    },
  },
  required: ['synthesis', 'takeaways', 'qa', 'moments'],
}

const SYSTEM = `You are Munshot, an AI that writes sharp one-page intelligence summaries of podcast episodes for busy operators and investors. You are given an episode's title, show, and the publisher's show-notes. Produce the summary by calling the emit_summary tool/function.

Rules:
- Base everything ONLY on the provided show-notes. Do NOT invent facts, quotes, names, or numbers.
- If the show-notes are thin or promotional, keep the summary brief and high-level rather than fabricating detail.
- synthesis: lead with the core argument; bold the few most important phrases with **double asterisks**.
- Be concrete and non-obvious in takeaways. Use "—" for a moment's timestamp when it isn't stated.`

function userMessage(input: SummarizeInput): string {
  return `Show: ${input.show}\nEpisode: ${input.title}\n\nShow notes:\n${input.notes || '(no show-notes provided)'}`
}

// Coerce a model's structured output into a valid Summary (defaults + moment ids).
function normalize(raw: Partial<Summary> | undefined): Summary {
  const r = raw ?? {}
  return {
    synthesis: r.synthesis ?? [],
    takeaways: r.takeaways ?? [],
    qa: r.qa ?? [],
    moments: (r.moments ?? []).map((m, i) => ({ ...m, id: `gen-${i}` })),
  }
}

// Tiny in-process cache so re-opening the same episode (same warm worker) doesn't re-spend.
const cache = new Map<string, Summary>()

export async function summarizeEpisode(input: SummarizeInput, config: SummarizeConfig): Promise<Summary> {
  const provider = config.openaiKey ? 'openai' : config.anthropicKey ? 'anthropic' : null
  if (!provider) throw new Error('no_api_key')
  const model = config.model || (provider === 'openai' ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL)

  const cacheKey = `${provider}:${model}::${input.title}`
  const hit = cache.get(cacheKey)
  if (hit) return hit

  const summary =
    provider === 'openai'
      ? await viaOpenAI(input, config.openaiKey as string, model)
      : await viaAnthropic(input, config.anthropicKey as string, model)

  if (cache.size > 300) cache.clear() // crude bound; fine for a prototype
  cache.set(cacheKey, summary)
  return summary
}

// ── OpenAI (Chat Completions + forced function call) ─────────────────────────
async function viaOpenAI(input: SummarizeInput, apiKey: string, model: string): Promise<Summary> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: 2048,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMessage(input) },
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
async function viaAnthropic(input: SummarizeInput, apiKey: string, model: string): Promise<Summary> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [{ name: 'emit_summary', description: 'Emit the structured one-page summary.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'emit_summary' },
      messages: [{ role: 'user', content: userMessage(input) }],
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
