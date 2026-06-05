import { summarizeEpisode } from '../../server/summarize'

// Cloudflare Pages Function → POST /api/summary (production).
// Reads the API key from the Pages project env (Settings → Variables → add
// OPENAI_API_KEY or ANTHROPIC_API_KEY as an encrypted secret). Provider is
// auto-detected by which key is present. Mirrors the Vite dev middleware.
export const onRequestPost = async (context: {
  request: Request
  env: { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; SUMMARY_MODEL?: string }
}): Promise<Response> => {
  const config = {
    openaiKey: context.env?.OPENAI_API_KEY,
    anthropicKey: context.env?.ANTHROPIC_API_KEY,
    model: context.env?.SUMMARY_MODEL || undefined,
  }
  const headers = { 'content-type': 'application/json' }

  if (!config.openaiKey && !config.anthropicKey) {
    return new Response(JSON.stringify({ error: 'no_api_key' }), { status: 503, headers })
  }

  try {
    const input = (await context.request.json()) as { title: string; show: string; notes: string }
    const summary = await summarizeEpisode(input, config)
    return new Response(JSON.stringify(summary), { headers })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'summarize_failed', detail: String(e).slice(0, 200) }), { status: 502, headers })
  }
}
