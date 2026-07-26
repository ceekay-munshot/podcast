import { describe, expect, it } from 'vitest'
import { episodeSourceUrl, sourceIcon, sourceLabel, sourceTarget } from './source'

type Ep = Parameters<typeof sourceTarget>[0]
type Show = NonNullable<Parameters<typeof sourceTarget>[1]>

const ep = (title: string, sourceUrl?: string, audioUrl?: string): Ep => ({ title, sourceUrl, audioUrl })
const show = (title: string, source: Show['source'] = 'podcast'): Show => ({ title, source })

// The button's branding has to match where the click lands. `podcast.source`
// can't decide that: it says 'podcast' for every audio show, but the link we
// hand out is the publisher's own permalink (libsyn, omny.fm, acquired.fm,
// sources.news…) far more often than it's Apple. Apple branding is only ever
// right on the search fallback.
describe('sourceTarget', () => {
  it('brands the Apple search fallback as Apple', () => {
    const t = sourceTarget(ep('Ep 1'), show('Acquired'))
    expect(t.href).toBe('https://podcasts.apple.com/us/search?term=Acquired%20Ep%201')
    expect(t.mark).toBe('apple')
    expect(t.host).toBeNull()
    expect(t.label).toBe('Listen on Apple Podcasts')
  })

  it('brands a publisher permalink by its host, not by Apple', () => {
    const t = sourceTarget(
      ep('TSMC', 'https://www.acquired.fm/episodes/tsmc', 'https://cdn.example.com/tsmc.mp3'),
      show('Acquired'),
    )
    expect(t.href).toBe('https://www.acquired.fm/episodes/tsmc') // link itself untouched
    expect(t.mark).toBe('web')
    expect(t.host).toBe('acquired.fm') // "www." stripped for display only
    expect(t.label).toBe('Listen at acquired.fm')
  })

  it('says "Read" for a written dispatch (no audio enclosure)', () => {
    const t = sourceTarget(ep('OpenAI closes the Simo chapter', 'https://sources.news/p/openai-closes-fidji-simo-chapter'), show('Sources'))
    expect(t.mark).toBe('web')
    expect(t.label).toBe('Read at sources.news')
  })

  it('says "Listen" for the audio drops in that same feed', () => {
    const t = sourceTarget(
      ep('Subscriber Q&A', 'https://sources.news/p/subscriber-q-and-a', 'https://api.substack.com/feed/podcast/201179474/6b70.mp3'),
      show('Sources'),
    )
    expect(t.label).toBe('Listen at sources.news')
  })

  it('keeps every real tracked host off Apple branding', () => {
    for (const [url, host] of [
      ['https://allinchamathjason.libsyn.com/e-200', 'allinchamathjason.libsyn.com'],
      ['https://podcasters.spotify.com/pod/show/x/episodes/y', 'podcasters.spotify.com'],
      ['https://omny.fm/shows/x/y', 'omny.fm'],
      ['https://shows.acast.com/x/episodes/y', 'shows.acast.com'],
      ['https://colossus.com/episodes/y', 'colossus.com'],
      ['https://www.lennysnewsletter.com/p/y', 'lennysnewsletter.com'],
      ['https://share.transistor.fm/s/abc123', 'share.transistor.fm'],
      ['https://the-ben-marc-show.simplecast.com/episodes/y', 'the-ben-marc-show.simplecast.com'],
    ] as const) {
      const t = sourceTarget(ep('Ep', url, 'https://cdn.example.com/ep.mp3'), show('Show'))
      expect(t.mark, url).toBe('web')
      expect(t.host, url).toBe(host)
      expect(t.label, url).toBe(`Listen at ${host}`)
    }
  })

  it('keeps Apple branding when the permalink really is Apple', () => {
    const t = sourceTarget(ep('Ep', 'https://podcasts.apple.com/us/podcast/foo/id123456?i=789', 'https://cdn.example.com/ep.mp3'), show('Foo'))
    expect(t.mark).toBe('apple')
    expect(t.host).toBeNull()
    expect(t.label).toBe('Listen on Apple Podcasts')
  })

  it('brands a YouTube show as YouTube', () => {
    const t = sourceTarget(ep('First Video', 'https://www.youtube.com/watch?v=ABC123'), show('Test Channel', 'youtube'))
    expect(t.href).toBe('https://www.youtube.com/watch?v=ABC123')
    expect(t.mark).toBe('youtube')
    expect(t.host).toBeNull()
    expect(t.label).toBe('Watch on YouTube')
  })

  it('stays on YouTube when a YouTube show’s RSS <link> points elsewhere', () => {
    // All-In: surfaced from YouTube, but its feed links to libsyn. The button
    // must not promise YouTube and land on libsyn — or vice versa.
    const t = sourceTarget(ep('E200', 'https://allinchamathjason.libsyn.com/e-200'), show('All-In', 'youtube'))
    expect(t.href).toBe('https://www.youtube.com/results?search_query=All-In%20E200')
    expect(t.mark).toBe('youtube')
    expect(t.label).toBe('Watch on YouTube')
  })

  it('falls back to a platform search when the episode has no sourceUrl', () => {
    expect(sourceTarget(ep('Ep 1'), show('All-In', 'youtube'))).toMatchObject({
      href: 'https://www.youtube.com/results?search_query=All-In%20Ep%201',
      mark: 'youtube',
      label: 'Watch on YouTube',
    })
    expect(sourceTarget(ep('Ep 1', undefined, 'https://cdn.example.com/ep.mp3'), show('Acquired'))).toMatchObject({
      href: 'https://podcasts.apple.com/us/search?term=Acquired%20Ep%201',
      mark: 'apple',
      label: 'Listen on Apple Podcasts', // the fallback IS Apple, so the copy is honest
    })
  })

  it('ignores a sourceUrl that is not a usable web link', () => {
    for (const junk of ['not a url', 'javascript:alert(1)', 'mailto:hi@example.com', '', 'data:text/plain,hi']) {
      const t = sourceTarget(ep('Ep 1', junk), show('Acquired'))
      expect(t.href, junk).toBe('https://podcasts.apple.com/us/search?term=Acquired%20Ep%201')
      expect(t.mark, junk).toBe('apple')
    }
  })

  it('works with no podcast at all', () => {
    expect(sourceTarget(ep('Orphan')).href).toBe('https://podcasts.apple.com/us/search?term=Orphan')
    expect(sourceTarget(ep('Orphan', 'https://example.com/x')).label).toBe('Read at example.com')
  })
})

// episodeSourceUrl is the single source of truth for the href; sourceTarget
// reads its label and mark straight back off that value.
describe('episodeSourceUrl', () => {
  it('agrees with the target it labels', () => {
    for (const e of [ep('A'), ep('B', 'https://omny.fm/x'), ep('C', 'not a url')]) {
      expect(episodeSourceUrl(e, show('S'))).toBe(sourceTarget(e, show('S')).href)
    }
  })
})

describe('sourceLabel / sourceIcon', () => {
  it('label mirrors the target label', () => {
    const e = ep('Ep', 'https://sources.news/p/x')
    expect(sourceLabel(e, show('Sources'))).toBe(sourceTarget(e, show('Sources')).label)
  })

  it('picks a glyph per destination, not per source kind', () => {
    expect(sourceIcon(ep('E', 'https://www.youtube.com/watch?v=ABC123'), show('C', 'youtube'))).toBe('smart_display')
    expect(sourceIcon(ep('E'), show('Acquired'))).toBe('podcasts') // Apple search fallback
    expect(sourceIcon(ep('E', 'https://omny.fm/x', 'https://cdn.example.com/e.mp3'), show('S'))).toBe('headphones')
    expect(sourceIcon(ep('E', 'https://sources.news/p/x'), show('Sources'))).toBe('article')
  })
})
