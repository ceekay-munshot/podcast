import type { Episode, Podcast } from './types'

// The episode's link at its origin. Real per-episode URLs slot into
// `episode.sourceUrl`; absent that, we search the source platform for the exact
// show + episode title, so the button always lands somewhere useful.

export function episodeSourceUrl(
  episode: Pick<Episode, 'title' | 'sourceUrl'>,
  podcast?: Pick<Podcast, 'title' | 'source'>,
): string {
  if (episode.sourceUrl) return episode.sourceUrl
  const q = encodeURIComponent(`${podcast?.title ?? ''} ${episode.title}`.trim())
  return podcast?.source === 'youtube'
    ? `https://www.youtube.com/results?search_query=${q}`
    : `https://podcasts.apple.com/us/search?term=${q}`
}

export function sourceLabel(podcast?: Pick<Podcast, 'source'>): string {
  return podcast?.source === 'youtube' ? 'Watch on YouTube' : 'Listen on Apple Podcasts'
}

export function sourceIcon(podcast?: Pick<Podcast, 'source'>): string {
  return podcast?.source === 'youtube' ? 'smart_display' : 'podcasts'
}
