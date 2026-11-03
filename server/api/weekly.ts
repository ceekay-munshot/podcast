import { getLiveEpisodes, parseMemberFeeds } from '../../server/feeds'
import { kvSummaryStore, sharedSummaryKey, type KVNamespace } from '../../server/summaryStore'
import { readyThisWeek } from '../../server/weeklyDigest'
import { assembleWeekly, mergeWeeklyAi, hashKey } from '../../src/lib/weeklyAssemble'
import { PODCASTS } from '../../src/lib/mock-data'
import type { Podcast } from '../../src/lib/types'

// Cloudflare Pages Function (served through the GitHub runner) → GET /api/weekly.
//
// A read-only URL that returns the LATEST weekly report as structured data, for
// the MCP (and any reader) — the gap called out in the migration notes: the
// weekly brief was only ever produced by the Monday digest job (which runs an
// LLM and emails a PDF), with no plain GET that hands the report back.
//
// This never runs the model. The report is assembled DETERMINISTICALLY from the
// shared per-episode summaries (assembleWeekly — the exact same base the emailed
// and on-screen editions are built on). If this week's AI narrative is already
// cached in the shared store (weekly:<hash>, written by the digest or an
// on-screen visit), it is layered on read-only; otherwise the complete
// deterministic base is returned. Either way: no transcription, no LLM call.
//
//   GET → { generatedAt, weekly: WeeklySummary }         (this week's edition)
//   GET → { generatedAt, weekly: null, note: '…' }       (nothing ready this week)
export const onRequestGet = async (
  context: { request: Request; env: { SUMMARIES?: KVNamespace; MEMBER_FEEDS?: string } },
): Promise<Response> => {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300, s-maxage=900' },
    })
  try {
    const store = context.env?.SUMMARIES ? kvSummaryStore(context.env.SUMMARIES) : undefined
    const now = Date.now()
    const all = await getLiveEpisodes(store, parseMemberFeeds(context.env?.MEMBER_FEEDS))
    const ready = readyThisWeek(all, now)
    const podcastById = (id: string): Podcast | undefined => PODCASTS.find((p) => p.id === id)

    // assembleWeekly assumes a non-empty set (it reads ready[0]); guard like the
    // digest does and return an honest empty state instead of crashing.
    if (!ready.length) {
      return json({ generatedAt: new Date(now).toISOString(), weekly: null, note: 'no_ready_episodes_this_week' })
    }

    let weekly = assembleWeekly(ready, podcastById)
    // Best-effort overlay of the cached AI narrative — NO model call. A hash miss
    // (or any store error) simply keeps the complete deterministic base.
    if (store) {
      try {
        const cached = await store.get(sharedSummaryKey(`weekly:${hashKey(ready)}`))
        if (cached?.weekly) weekly = mergeWeeklyAi(weekly, cached.weekly)
      } catch { /* deterministic base is already a complete report */ }
    }
    return json({ generatedAt: new Date(now).toISOString(), weekly })
  } catch {
    return json({ generatedAt: new Date().toISOString(), weekly: null, note: 'weekly_unavailable' })
  }
}
