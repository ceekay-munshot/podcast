// ─────────────────────────────────────────────────────────────────────────────
// Claude via AWS Bedrock — an OPT-IN, parallel LLM path selected only when
// LLM_PROVIDER=claude (see resolveProvider in summarize.ts). Self-contained by
// design: this file + the small toggle in summarize.ts is the entire path, so
// it can be deleted later without touching the OpenAI / Anthropic-direct code.
//
// Auth: Bedrock's bearer-token API (not SigV4) — the same shape as the OpenAI /
// Anthropic-direct fetches this repo already makes, just against the Bedrock
// Runtime Converse endpoint. Set BEDROCK_API_KEY (the Bedrock-console bearer key,
// the same convention as the paramemo/tybourne repos) and this path is selected.
//
// The model + region default to Claude Sonnet 4.6 on the global cross-region
// profile in us-east-1 — the exact model the tybourne newsletter already runs on,
// so it is known-granted in this account. Override with BEDROCK_MODEL_IDS /
// AWS_REGION (or the older BEDROCK_MODEL_ID / BEDROCK_REGION) if needed.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_BEDROCK_MODEL = 'global.anthropic.claude-sonnet-4-6'
export const DEFAULT_BEDROCK_REGION = 'us-east-1'

/** Calls Claude on Bedrock with forced tool use and returns the RAW tool-input
 *  object — the exact same contract as viaOpenAI/viaAnthropic in summarize.ts,
 *  so normalize()/normalizeWeeklyAi() (and therefore every HTTP response shape)
 *  are byte-identical regardless of which provider answered. */
export async function viaBedrock(
  prompt: { system: string; user: string },
  apiKey: string,
  model: string,
  schema: object,
  region: string = DEFAULT_BEDROCK_REGION,
): Promise<unknown> {
  const res = await fetch(`https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(model)}/converse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      system: [{ text: prompt.system }],
      messages: [{ role: 'user', content: [{ text: prompt.user }] }],
      toolConfig: {
        tools: [{ toolSpec: { name: 'emit_summary', description: 'Emit the structured summary.', inputSchema: { json: schema } } }],
        toolChoice: { tool: { name: 'emit_summary' } },
      },
      // Mirrors the 16000-token ceiling used by the OpenAI/Anthropic paths.
      inferenceConfig: { maxTokens: 16000 },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`bedrock ${res.status}: ${body.slice(0, 200)}`)
  }
  const data: { output?: { message?: { content?: Array<{ toolUse?: { name?: string; input?: unknown } }> } } } = await res.json()
  const content = data.output?.message?.content ?? []
  const toolUse = content.find((b) => b.toolUse?.name === 'emit_summary')?.toolUse
  if (!toolUse?.input) throw new Error('bedrock: no emit_summary tool use in response')
  return toolUse.input
}
