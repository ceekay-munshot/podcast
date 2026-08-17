import type { Episode, Podcast, PodcastFeed } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Pooling a show that publishes to several feeds into ONE episode list.
//
// A single show routinely ships the same instalment three ways: members-only
// audio, a free video, and a written post. Tracking those as three shows gives
// the user three near-identical rows for one thing and three separate summaries
// of it. Pooling gives them one episode per instalment, assembled from whichever
// source carried each part.
//
// That last point is what makes pooling worth the code: the merge is a UNION,
// not a pick. The paid feed carries the audio (so the episode becomes
// transcribable), the article feed carries the full written body (the best
// summary material), YouTube carries the watch link (the in-app player). Taking
// the best field from each produces an episode richer than any one source — and
// the free sources keep working when the paid one is absent.
//
// Two rules keep de-duplication honest:
//   • Only ACROSS sources. A feed's own items are distinct by definition, so two
//     items from the same feed are never merged, however alike their titles.
//   • Titles must match after normalizing, AND publish within a window. Same
//     title years apart is a rerun or a reused heading, not one episode.
// ─────────────────────────────────────────────────────────────────────────────

/** Every feed behind a show, in priority order, normalized from either shape. */
export function feedsOf(p: Pick<Podcast, 'feeds' | 'feedUrl'>): PodcastFeed[] {
  if (p.feeds?.length) return p.feeds.filter((f) => !!f?.feedUrl)
  return p.feedUrl ? [{ feedUrl: p.feedUrl }] : []
}

/** The URLs behind a show, in priority order. */
export const feedUrlsOf = (p: Pick<Podcast, 'feeds' | 'feedUrl'>): string[] => feedsOf(p).map((f) => f.feedUrl)

/** Same feed? Compared the way the roster compares them — trailing slash and host
 *  case are noise, but the query string is not (a member feed's token lives there). */
export function sameFeed(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const x = new URL(u.trim())
      return `${x.protocol}//${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, '')}${x.search}`
    } catch {
      return u.trim().toLowerCase()
    }
  }
  return norm(a) === norm(b)
}

/** Add feeds to a show's list, keeping order and dropping URLs already present. */
export function mergeFeeds(existing: PodcastFeed[], incoming: PodcastFeed[]): PodcastFeed[] {
  const out = [...existing]
  for (const f of incoming) {
    if (!f?.feedUrl || out.some((e) => sameFeed(e.feedUrl, f.feedUrl))) continue
    out.push(f)
  }
  return out
}

/** Days apart two items may publish and still be the same instalment. Wide on
 *  purpose: a video edit of an audio drop lands a week or two later, and a paid
 *  post can precede its free write-up. Narrow enough that a reused heading a year
 *  later stays its own episode. */
const WINDOW_DAYS = 45

/** The identity of an instalment, for matching across a show's feeds.
 *
 *  Titles differ cosmetically per platform: YouTube appends the channel brand
 *  ("… | Stratechery by Ben Thompson"), feeds differ on curly vs straight quotes,
 *  and one may prefix the show name. Strip all of that, then compare on letters
 *  and digits alone. Returns '' for a title with no comparable content, which the
 *  caller treats as "never merge". */
export function poolKey(title: string, show?: { title?: string; author?: string }): string {
  let s = (title || '').trim()
  if (!s) return ''
  // A pipe is a brand/channel separator in practice, never part of a real title.
  const pipe = s.indexOf('|')
  if (pipe > 0) s = s.slice(0, pipe)
  // A dash-separated suffix IS often part of a title, so only strip it when it's
  // the show's own name or its author — something we know rather than guess.
  for (const brand of [show?.title, show?.author].filter((v): v is string => !!v)) {
    const b = plainKey(brand)
    if (!b) continue
    for (const sep of [' - ', ' – ', ' — ', ': ']) {
      const at = s.lastIndexOf(sep)
      if (at > 0 && plainKey(s.slice(at + sep.length)) === b) s = s.slice(0, at)
    }
    // A leading "Show Name: …" prefix.
    for (const sep of [': ', ' - ', ' – ', ' — ']) {
      const at = s.indexOf(sep)
      if (at > 0 && plainKey(s.slice(0, at)) === b) s = s.slice(at + sep.length)
    }
  }
  return plainKey(s)
}

/** Letters and digits only, lowercased — quotes, dashes and spacing all vary by
 *  platform for the same title. */
function plainKey(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'") // curly apostrophes → straight
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const time = (iso: string): number => {
  const t = +new Date(iso)
  return Number.isFinite(t) ? t : 0
}

const longest = (...v: (string | undefined)[]): string | undefined =>
  v.filter((x): x is string => !!x).sort((a, b) => b.length - a.length)[0]

const firstOf = (...v: (string | undefined)[]): string | undefined => v.find((x) => !!x)

const isYouTubeLink = (url?: string) => !!url && /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)

/** The episode's own name, with a platform's channel branding removed — YouTube
 *  titles carry "… | Show Name by Author", which is the channel talking, not the
 *  episode. Applied throughout a pooled list so it reads as one show rather than a
 *  mix of platform conventions. Only strips when something is left over. */
export function displayTitle(title: string): string {
  const at = (title || '').indexOf('|')
  if (at <= 0) return title
  const head = title.slice(0, at).trim()
  return head || title
}

/** Merge one instalment's copies (in feed order) into a single episode.
 *
 *  Field by field, whichever source has the most to offer:
 *   • id           — the FIRST contributor's, so adding or removing a feed later
 *                    never re-keys an episode (ids key the summary cache and the
 *                    user's processed history).
 *   • title        — the shortest, i.e. the one without a platform's brand suffix.
 *   • publishedAt  — the earliest: when the instalment actually came out.
 *   • audio /
 *     transcript   — the first source that has one. This is the whole point: a
 *                    members-only audio feed makes the episode transcribable.
 *   • notes        — the longest: the article body beats a video description.
 *   • sourceUrl    — a YouTube watch link when any source has one (it plays in
 *                    app, and opens for everyone), else the first link.
 *   • summary      — kept if any copy already carries one (the shared-store overlay).
 */
function mergeGroup(group: { ep: Episode; label?: string }[]): Episode {
  const eps = group.map((g) => g.ep)
  const [first] = eps
  // De-duplicated: two member feeds from the same publisher (one carrying the
  // audio, one the full text) share a label, and "Member feed, Member feed" tells
  // the reader nothing the single label doesn't.
  const labels = [...new Set(group.map((g) => g.label).filter((l): l is string => !!l))]
  const withSummary = eps.find((e) => !!e.summary)
  const video = eps.find((e) => isYouTubeLink(e.sourceUrl))
  const merged: Episode = {
    ...first,
    title: displayTitle(eps.reduce((a, b) => (b.title.length < a.title.length ? b : a)).title),
    publishedAt: eps.reduce((a, b) => (time(b.publishedAt) && time(b.publishedAt) < time(a.publishedAt) ? b : a)).publishedAt,
    durationSec: Math.max(...eps.map((e) => e.durationSec || 0)),
    blurb: firstOf(...eps.map((e) => e.blurb)) ?? first.blurb,
    notes: longest(...eps.map((e) => e.notes)),
    audioUrl: firstOf(...eps.map((e) => e.audioUrl)),
    transcriptUrl: firstOf(...eps.map((e) => e.transcriptUrl)),
    sourceUrl: video?.sourceUrl ?? firstOf(...eps.map((e) => e.sourceUrl)),
    entities: eps.find((e) => e.entities?.people?.length || e.entities?.companies?.length || e.entities?.themes?.length)?.entities ??
      first.entities,
    ...(withSummary ? { status: withSummary.status, summary: withSummary.summary, transcript: withSummary.transcript } : {}),
    ...(labels.length > 1 ? { sources: labels } : {}),
  }
  // Don't carry empty optionals — an absent field means "none", and `notes: undefined`
  // would serialize as a key that isn't there anyway.
  if (!merged.notes) delete merged.notes
  if (!merged.audioUrl) delete merged.audioUrl
  if (!merged.transcriptUrl) delete merged.transcriptUrl
  if (!merged.sourceUrl) delete merged.sourceUrl
  return merged
}

export interface PoolOpts {
  /** Names each list for `Episode.sources` disclosure, in the same order. */
  labels?: (string | undefined)[]
  /** The show, so its own name can be recognized as a title's brand suffix. */
  show?: { title?: string; author?: string }
}

/** Pool a show's per-feed episode lists (in feed priority order) into one list,
 *  newest first. */
export function poolEpisodes(lists: Episode[][], opts: PoolOpts = {}): Episode[] {
  const labels = opts.labels ?? []
  // Single source → nothing to pool. Return it untouched so a one-feed show keeps
  // exactly the ids and fields it has today.
  const present = lists.filter((l) => l?.length)
  if (present.length <= 1) return (present[0] ?? []).slice()

  const groups: { key: string; at: number; items: { ep: Episode; label?: string }[]; feeds: Set<number> }[] = []
  lists.forEach((list, feedIndex) => {
    for (const ep of list ?? []) {
      const key = poolKey(ep.title, opts.show)
      const at = time(ep.publishedAt)
      // Same instalment = same normalized title, published within the window, and
      // from a DIFFERENT feed than the group already holds.
      const hit = key
        ? groups.find(
            (g) =>
              g.key === key &&
              !g.feeds.has(feedIndex) &&
              (!g.at || !at || Math.abs(g.at - at) <= WINDOW_DAYS * 86_400_000),
          )
        : undefined
      if (hit) {
        hit.items.push({ ep, label: labels[feedIndex] })
        hit.feeds.add(feedIndex)
      } else {
        groups.push({ key, at, items: [{ ep, label: labels[feedIndex] }], feeds: new Set([feedIndex]) })
      }
    }
  })
  return groups.map((g) => mergeGroup(g.items)).sort((a, b) => time(b.publishedAt) - time(a.publishedAt))
}
