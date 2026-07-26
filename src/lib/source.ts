import type { Episode, Podcast } from './types'

/** Bare, display-ready host for an http(s) URL ("www." stripped), or null when
 *  the string isn't a usable web link — feeds do hand us junk in <link>. */
function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.replace(/^www\./i, '').toLowerCase() || null
  } catch {
    return null
  }
}

function isYouTubeHost(host: string): boolean {
  return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')
}

function isAppleHost(host: string): boolean {
  return host === 'apple.com' || host.endsWith('.apple.com') || host === 'apple.co'
}

function isYouTubeUrl(url: string): boolean {
  const host = hostOf(url)
  return !!host && isYouTubeHost(host)
}

// The episode's link at its origin. Real per-episode URLs slot into
// `episode.sourceUrl`, but only when they match the button's destination: a
// YouTube-surfaced show (e.g. All-In) whose RSS <link> points to libsyn must not
// send a "Watch on YouTube" click to libsyn. When there's no matching link, we
// search the source platform for the exact show + episode title, so the button
// always lands on the right platform.

export function episodeSourceUrl(
  episode: Pick<Episode, 'title' | 'sourceUrl'>,
  podcast?: Pick<Podcast, 'title' | 'source'>,
): string {
  const youtube = podcast?.source === 'youtube'
  // hostOf() also rejects unparseable / non-http links, so callers can always
  // read a real host back off the value we return.
  if (episode.sourceUrl && hostOf(episode.sourceUrl) && (!youtube || isYouTubeUrl(episode.sourceUrl))) {
    return episode.sourceUrl
  }
  const q = encodeURIComponent(`${podcast?.title ?? ''} ${episode.title}`.trim())
  return youtube
    ? `https://www.youtube.com/results?search_query=${q}`
    : `https://podcasts.apple.com/us/search?term=${q}`
}

/** Which platform mark to draw. 'web' = the publisher's own site — nearly every
 *  tracked show, since RSS <link> is a publisher permalink. */
export type SourceMarkKind = 'apple' | 'youtube' | 'web'

export interface SourceTarget {
  /** Where the button actually goes. */
  href: string
  mark: SourceMarkKind
  /** Display host behind `href` for the 'web' mark ("sources.news"); null for
   *  the two platforms that get named branding instead. */
  host: string | null
  /** Button copy — honest about both the verb and the destination. */
  label: string
}

// Label and mark are derived from the RESOLVED href, never from `podcast.source`
// alone: `source: 'podcast'` only means "this show came in as audio", and the
// link we hand the user is almost always the publisher's own permalink (libsyn,
// omny.fm, acquired.fm, sources.news…), not Apple. Apple branding is correct
// only on the search fallback, i.e. when an episode has no usable sourceUrl.
// The verb follows the media, so Sources' written dispatches read "Read at",
// not "Listen on".
export function sourceTarget(
  episode: Pick<Episode, 'title' | 'sourceUrl' | 'audioUrl'>,
  podcast?: Pick<Podcast, 'title' | 'source'>,
): SourceTarget {
  const href = episodeSourceUrl(episode, podcast)
  const host = hostOf(href)
  if (host && isYouTubeHost(host)) return { href, mark: 'youtube', host: null, label: 'Watch on YouTube' }
  if (!host || isAppleHost(host)) return { href, mark: 'apple', host: null, label: 'Listen on Apple Podcasts' }
  return { href, mark: 'web', host, label: `${episode.audioUrl ? 'Listen' : 'Read'} at ${host}` }
}

const idish = (s?: string | null) => (s && /^[\w-]{6,}$/.test(s) ? s : null)

/** The YouTube video id behind an episode's sourceUrl, when it links straight to
 *  a video. Drives the in-app player: youtube.com itself refuses to render in
 *  embedded contexts (X-Frame-Options), so wherever we have an id we play via
 *  the /embed/ endpoint instead of navigating — which works even when the whole
 *  app is running inside someone else's (sandboxed) iframe. */
export function youtubeVideoId(episode: Pick<Episode, 'sourceUrl'>): string | null {
  const url = episode.sourceUrl
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    if (host === 'youtu.be') return idish(u.pathname.split('/').filter(Boolean)[0])
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return idish(v)
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/)
      if (m) return idish(m[1])
    }
  } catch {
    /* not a URL */
  }
  return null
}

export function sourceLabel(
  episode: Pick<Episode, 'title' | 'sourceUrl' | 'audioUrl'>,
  podcast?: Pick<Podcast, 'title' | 'source'>,
): string {
  return sourceTarget(episode, podcast).label
}

/** Material Symbols glyph for the destination — the text-only counterpart to
 *  <SourceMark>, for places too dense for a brand tile. */
export function sourceIcon(
  episode: Pick<Episode, 'title' | 'sourceUrl' | 'audioUrl'>,
  podcast?: Pick<Podcast, 'title' | 'source'>,
): string {
  const { mark } = sourceTarget(episode, podcast)
  if (mark === 'youtube') return 'smart_display'
  if (mark === 'apple') return 'podcasts'
  return episode.audioUrl ? 'headphones' : 'article'
}
