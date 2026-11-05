import { hasLlmKey, summarizeEpisode, synthesizeWeekly, type SynthesizeWeeklyInput } from '../../server/summarize'
import { kvSummaryStore, type KVNamespace } from '../../server/summaryStore'

// Cloudflare Pages Function → POST /api/summary (production).
// Reads the API key from the Pages project env (Settings → Variables → add
// OPENAI_API_KEY or ANTHROPIC_API_KEY as an encrypted secret). Provider is
// auto-detected by which key is present. Mirrors the Vite dev middleware.
// SUMMARIES (a KV namespace binding) is the shared, persistent summary cache:
// when bound, a processed episode is reused across all users instead of recomputed.
//
// Claude-via-Bedrock path (server/bedrock.ts): set BEDROCK_API_KEY (the Bedrock
// bearer key, same convention as the paramemo/tybourne repos) and it is used
// automatically — no other flag needed (see resolveProvider in summarize.ts).
// LLM_PROVIDER can still force openai/anthropic; temp_claude_token stays supported
// for back-compat.
export const onRequestPost = async (context: {
  request: Request
  env: {
    OPENAI_API_KEY?: string
    ANTHROPIC_API_KEY?: string
    SUMMARY_MODEL?: string
    GROQ_API_KEY?: string
    DEEPGRAM_API_KEY?: string
    DEEPGRAM_MODEL?: string
    SUMMARIES?: KVNamespace
    LLM_PROVIDER?: string
    BEDROCK_API_KEY?: string
    temp_claude_token?: string
    BEDROCK_MODEL_ID?: string
    BEDROCK_MODEL_IDS?: string
    BEDROCK_REGION?: string
    AWS_REGION?: string
  }
}): Promise<Response> => {
  const config = {
    openaiKey: context.env?.OPENAI_API_KEY,
    anthropicKey: context.env?.ANTHROPIC_API_KEY,
    model: context.env?.SUMMARY_MODEL || undefined,
    deepgramKey: context.env?.DEEPGRAM_API_KEY, // transcription for long episodes
    deepgramModel: context.env?.DEEPGRAM_MODEL || undefined,
    groqKey: context.env?.GROQ_API_KEY, // free-tier Whisper (short episodes)
    // Shared cache — absent binding degrades gracefully to per-request compute.
    store: context.env?.SUMMARIES ? kvSummaryStore(context.env.SUMMARIES) : undefined,
    llmProvider: context.env?.LLM_PROVIDER,
    // BEDROCK_API_KEY is the standard name (paramemo/tybourne); temp_claude_token kept for back-compat.
    bedrockKey: context.env?.BEDROCK_API_KEY || context.env?.temp_claude_token,
    bedrockModel: context.env?.BEDROCK_MODEL_ID || context.env?.BEDROCK_MODEL_IDS?.split(',')[0]?.trim() || undefined,
    bedrockRegion: context.env?.AWS_REGION || context.env?.BEDROCK_REGION || undefined,
  }
  const headers = { 'content-type': 'application/json' }

  if (!hasLlmKey(config)) {
    return new Response(JSON.stringify({ error: 'no_api_key' }), { status: 503, headers })
  }

  try {
    const input = (await context.request.json()) as ({ mode?: 'episode' | 'weekly' } & Record<string, unknown>)
    // Weekly cross-episode synthesis (the Guidepoint layer) shares this endpoint —
    // it just drives a different schema/prompt and returns { weekly: WeeklyAi }.
    if (input.mode === 'weekly') {
      const weekly = await synthesizeWeekly(input as unknown as SynthesizeWeeklyInput, config)
      return new Response(JSON.stringify({ weekly }), { headers })
    }
    const result = await summarizeEpisode(input as unknown as { title: string; show: string; notes: string }, config) // { summary, transcript, transcriptSource }
    return new Response(JSON.stringify(result), { headers })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'summarize_failed', detail: String(e).slice(0, 200) }), { status: 502, headers })
  }
}
