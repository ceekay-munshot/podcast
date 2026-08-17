import { describe, expect, it } from 'vitest'
import { knownResultsForQuery, knownShowBySpotifyId, knownShowByTerm, memberFeedInfo } from './knownSources'
import { parseSpotifyEmbed, parseSpotifyOembed, spotifyShowId, titleMatches } from '../../server/spotify'
import type { PodcastSearchResult } from './types'

// A show that publishes no public feed is invisible to every directory — search
// "Stratechery" in Apple and you get Sharp Tech, Exponent and Acquired, i.e.
// everything except the show asked for. The registry is what stops Discover from
// silently answering the wrong question.
describe('knownShowByTerm', () => {
  it('matches the show by name and by its aliases, ignoring case and padding', () => {
    for (const term of ['Stratechery', '  stratechery ', 'Stratechery by Ben Thompson', 'Ben Thompson']) {
      expect(knownShowByTerm(term)?.key, term).toBe('stratechery')
    }
  })

  it('does not match a different show that merely mentions the same person', () => {
    for (const term of ['Sharp Tech with Ben Thompson', 'exponent', 'stratechery daily update', '']) {
      expect(knownShowByTerm(term), term).toBeNull()
    }
  })

  it('finds the show behind its Spotify id', () => {
    expect(knownShowBySpotifyId('1jRACH7L8EQCYKc5uW7aPk')?.key).toBe('stratechery')
    expect(knownShowBySpotifyId('7Fj0XEuUQLUqoMZQdsLXqp')).toBeNull() // Acquired — free, not in the registry
    expect(knownShowBySpotifyId('')).toBeNull()
  })
})

describe('knownResultsForQuery', () => {
  const cards = knownResultsForQuery('stratechery')

  it('leads with the paywalled source, carrying nothing that could be fetched', () => {
    expect(cards[0].access).toBe('paid')
    expect(cards[0].feedUrl).toBe('') // no feed → the card renders locked
    expect(cards[0].webUrl).toContain('open.spotify.com/show/')
    expect(cards[0].accessNote).toMatch(/subscriber-only/i)
  })

  it('offers the free sources with real, fetchable feeds', () => {
    const free = cards.slice(1)
    expect(free.length).toBeGreaterThan(0)
    for (const c of free) {
      expect(c.feedUrl, c.title).toMatch(/^https:\/\//)
      expect(c.access, c.title).not.toBe('paid')
    }
    const youtube = free.find((c) => c.source === 'youtube')!
    expect(youtube.feedUrl).toBe('https://www.youtube.com/feeds/videos.xml?channel_id=UC9AHywQeW9BOcOl7dg-YMqA')
    // Same id the server derives from a pasted channel URL, so the two dedupe.
    expect(youtube.id).toBe('yt-UC9AHywQeW9BOcOl7dg-YMqA')
    // The article feed carries free articles in full and paid ones as teasers.
    expect(free.find((c) => c.access === 'partial')?.feedUrl).toBe('https://stratechery.com/feed/')
  })

  it('points only the paid card at the member-feed page — a free source needs no subscription', () => {
    expect(cards[0].memberFeedPage).toContain('passport.online')
    for (const c of cards.slice(1)) expect(c.memberFeedPage, c.title).toBeUndefined()
  })

  it('returns nothing for a query that names no known show', () => {
    expect(knownResultsForQuery('odd lots')).toEqual([])
  })
})

// A member feed is the ONE route to a show's paid episodes, so it must be
// trackable — and flagged, because the URL is a credential.
describe('memberFeedInfo', () => {
  it('recognizes a Passport member feed and names the show behind it', () => {
    const info = memberFeedInfo('https://stratechery.passport.online/feed/podcast/TOKEN123456789')!
    expect(info.access).toBe('private')
    expect(info.show?.key).toBe('stratechery')
    expect(info.note).toMatch(/secret/i) // the note has to warn that the URL is a credential
  })

  it('recognizes other membership platforms, and any feed carrying a credential param', () => {
    for (const url of [
      'https://example.supercast.com/feed/abc',
      'https://api.memberful.com/rss/xyz',
      'https://www.patreon.com/rss/creator?auth=abcdefghij',
      'https://feeds.example.com/show.rss?access_token=abcdefghij',
    ]) {
      expect(memberFeedInfo(url)?.access, url).toBe('private')
    }
  })

  it('leaves ordinary public feeds alone — including ones with long opaque ids', () => {
    for (const url of [
      'https://feeds.megaphone.fm/CLS2859450455',
      'https://feeds.acast.com/public/shows/622618c7057f3400120d15db', // 24 hex chars, fully public
      'https://anchor.fm/s/f7cac464/podcast/rss',
      'https://api.substack.com/feed/podcast/10845.rss',
      'https://stratechery.com/feed/',
      'not a url',
    ]) {
      expect(memberFeedInfo(url), url).toBeNull()
    }
  })

  it('ignores a token param too short to be one', () => {
    expect(memberFeedInfo('https://feeds.example.com/show.rss?token=1')).toBeNull()
  })
})

// Spotify publishes no feed for anyone, so a pasted show URL can only tell us
// WHICH show is meant and whether Spotify would stream it to anybody.
describe('spotifyShowId', () => {
  const ID = '1jRACH7L8EQCYKc5uW7aPk'

  it('reads the id from web, locale, embed and URI forms', () => {
    expect(spotifyShowId(`https://open.spotify.com/show/${ID}`)).toBe(ID)
    expect(spotifyShowId(`https://open.spotify.com/show/${ID}?si=abc123&nd=1`)).toBe(ID)
    expect(spotifyShowId(`https://open.spotify.com/intl-de/show/${ID}`)).toBe(ID)
    expect(spotifyShowId(`https://open.spotify.com/embed/show/${ID}`)).toBe(ID)
    expect(spotifyShowId(`spotify:show:${ID}`)).toBe(ID)
  })

  it('rejects episode/playlist links, other hosts, and malformed ids', () => {
    for (const url of [
      'https://open.spotify.com/episode/4DxCcTmaQqEUqV7JHkHYIx',
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'https://podcasters.spotify.com/pod/show/x',
      'https://example.com/show/1jRACH7L8EQCYKc5uW7aPk',
      'https://open.spotify.com/show/tooshort',
      'https://open.spotify.com/show/',
      'not a url',
      '',
    ]) {
      expect(spotifyShowId(url), url).toBeNull()
    }
  })
})

// The paid/free call comes from Spotify's own embed payload. Getting this
// backwards would either hide a free show or accuse a free one of being paid,
// so both directions are pinned here against real response shapes.
describe('parseSpotifyEmbed', () => {
  const embed = (entity: unknown) =>
    `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { state: { data: { entity } } } },
    })}</script></body></html>`

  const paid = {
    type: 'episode',
    name: 'Anthropic’s Watermarking, How It (Probably) Works',
    subtitle: 'Stratechery',
    isPlayable: false,
    playabilityReason: 'UNAVAILABLE',
    relatedEntityCoverArt: [
      { url: 'https://image-cdn-fa.spotifycdn.com/image/small', maxWidth: 64 },
      { url: 'https://image-cdn-fa.spotifycdn.com/image/large', maxWidth: 640 },
    ],
  }

  it('reads a subscriber-only show as not playable', () => {
    const meta = parseSpotifyEmbed(embed(paid))!
    expect(meta.playable).toBe(false)
    expect(meta.reason).toBe('UNAVAILABLE')
  })

  it('titles the card with the SHOW, never the newest episode', () => {
    expect(parseSpotifyEmbed(embed(paid))!.name).toBe('Stratechery')
  })

  it('takes the largest artwork within the size cards render at', () => {
    expect(parseSpotifyEmbed(embed(paid))!.artworkUrl).toBe('https://image-cdn-fa.spotifycdn.com/image/large')
  })

  it('reads a free show as playable', () => {
    const meta = parseSpotifyEmbed(
      embed({ type: 'episode', name: 'Disney', subtitle: 'Acquired', isPlayable: true, playabilityReason: 'PLAYABLE' }),
    )!
    expect(meta.playable).toBe(true)
    expect(meta.name).toBe('Acquired')
  })

  it('assumes playable when the field is missing rather than inventing a paywall', () => {
    expect(parseSpotifyEmbed(embed({ type: 'show', name: 'Some Show' }))!.playable).toBe(true)
  })

  it('returns null for a dead id, a non-embed page, and malformed JSON', () => {
    expect(parseSpotifyEmbed(embed({}))).toBeNull() // unknown id → empty entity
    expect(parseSpotifyEmbed('<html><body>nope</body></html>')).toBeNull()
    expect(parseSpotifyEmbed('<script id="__NEXT_DATA__">{oops</script>')).toBeNull()
  })
})

describe('parseSpotifyOembed', () => {
  it('takes the thumbnail and title', () => {
    expect(parseSpotifyOembed({ title: 'Some Episode', thumbnail_url: 'https://image-cdn-ak.spotifycdn.com/image/x' })).toEqual({
      title: 'Some Episode',
      artworkUrl: 'https://image-cdn-ak.spotifycdn.com/image/x',
    })
  })

  it('drops a non-https thumbnail and survives junk input', () => {
    expect(parseSpotifyOembed({ thumbnail_url: 'http://insecure/x' }).artworkUrl).toBeUndefined()
    expect(parseSpotifyOembed(null)).toEqual({ title: undefined, artworkUrl: undefined })
  })
})

// Spotify hands us a show NAME; the ingestible thing is an RSS feed found by that
// name. Matching loosely would track "Sharp Tech" under the name "Stratechery".
describe('titleMatches', () => {
  const rows: PodcastSearchResult[] = [
    { id: 'a', title: 'Sharp Tech with Ben Thompson', author: '', category: '', description: '', feedUrl: 'https://x/1', source: 'podcast' },
    { id: 'b', title: 'Exponent', author: '', category: '', description: '', feedUrl: 'https://x/2', source: 'podcast' },
    { id: 'c', title: 'Acquired', author: '', category: '', description: '', feedUrl: 'https://x/3', source: 'podcast' },
  ]

  it('keeps an exact match and a title that only adds a qualifier', () => {
    expect(titleMatches('Acquired', rows).map((r) => r.id)).toEqual(['c'])
    expect(titleMatches('Sharp Tech', rows).map((r) => r.id)).toEqual(['a'])
  })

  it('drops shows that merely share a person or a word', () => {
    expect(titleMatches('Stratechery', rows)).toEqual([])
    expect(titleMatches('Ben Thompson', rows)).toEqual([])
    expect(titleMatches('', rows)).toEqual([])
  })
})
