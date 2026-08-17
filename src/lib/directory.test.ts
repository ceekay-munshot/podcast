import { describe, expect, it } from 'vitest'
import { formatDuration } from './format'
import { isPublicHttpUrl } from '../../server/safeUrl'
import { audioEnclosure, parseAtomEntries, parseEpisodes } from '../../server/feeds'
import { advertisedFeedUrl, channelIdIn, youtubePlaylistId } from '../../server/search'

// The SSRF guard is the security boundary for every user-supplied URL we fetch
// server-side (search input + /api/episodes?feed=). These are the cases the
// product requirements call out explicitly.
describe('isPublicHttpUrl', () => {
  it('allows ordinary public http(s) URLs', () => {
    for (const url of [
      'https://feeds.megaphone.fm/CLS2859450455',
      'http://feeds.transistor.fm/acquired',
      'https://podcasts.apple.com/us/podcast/foo/id123456',
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc',
      'https://example.com:8443/feed.rss',
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(true)
    }
  })

  it('rejects non-http(s) protocols', () => {
    for (const url of ['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'gopher://x']) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
  })

  it('rejects loopback and localhost', () => {
    for (const url of ['http://localhost/x', 'http://foo.localhost/x', 'http://127.0.0.1/x', 'https://127.255.1.2/x', 'http://[::1]/x']) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
  })

  it('rejects private, link-local, CGNAT and unspecified ranges', () => {
    for (const url of [
      'http://0.0.0.0/x', // 0.0.0.0/8
      'http://10.0.0.5/x', // RFC1918
      'http://172.16.0.1/x', // RFC1918
      'http://172.31.255.255/x', // RFC1918
      'http://192.168.1.1/x', // RFC1918
      'http://169.254.169.254/latest/meta-data', // cloud metadata
      'http://169.254.1.1/x', // link-local
      'http://100.64.0.1/x', // CGNAT
      'http://100.127.255.255/x', // CGNAT
    ]) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
  })

  it('allows public IPs adjacent to private ranges', () => {
    for (const url of ['http://172.15.0.1/x', 'http://172.32.0.1/x', 'http://100.63.0.1/x', 'http://100.128.0.1/x', 'http://8.8.8.8/x']) {
      expect(isPublicHttpUrl(url), url).toBe(true)
    }
  })

  it('rejects IPv6 loopback/unique-local/link-local and IPv4-mapped privates', () => {
    for (const url of ['http://[::]/x', 'http://[::1]/x', 'http://[fc00::1]/x', 'http://[fd12:3456::1]/x', 'http://[fe80::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[::ffff:10.0.0.1]/x']) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
  })

  it('rejects malformed input without throwing', () => {
    for (const url of ['', 'not a url', 'http://', '//evil.com', '   ']) {
      expect(isPublicHttpUrl(url), url).toBe(false)
    }
  })
})

// YouTube channel feeds are Atom, not RSS — this verifies the new parser maps an
// <entry> to a valid Episode (the shape the rest of the app relies on).
describe('parseAtomEntries (YouTube)', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
    <title>Test Channel</title>
    <author><name>Test Channel</name></author>
    <entry>
      <id>yt:video:ABC123</id>
      <yt:videoId>ABC123</yt:videoId>
      <title>First Video &amp; More</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=ABC123"/>
      <published>2026-05-01T12:00:00+00:00</published>
      <media:group><media:description>Hello world description.</media:description></media:group>
    </entry>
    <entry>
      <id>yt:video:DEF456</id>
      <yt:videoId>DEF456</yt:videoId>
      <title>Second Video</title>
      <link rel="alternate" href="https://www.youtube.com/watch?v=DEF456"/>
      <published>2026-04-01T08:30:00+00:00</published>
      <media:group><media:description>Another description.</media:description></media:group>
    </entry>
  </feed>`

  it('maps entries to Episodes with the required fields', () => {
    const eps = parseAtomEntries(xml, 'yt-test')
    expect(eps).toHaveLength(2)
    const [first] = eps
    expect(first.podcastId).toBe('yt-test')
    expect(first.id.startsWith('live-yt-test-')).toBe(true)
    expect(first.title).toBe('First Video & More') // entities decoded
    expect(first.sourceUrl).toBe('https://www.youtube.com/watch?v=ABC123')
    expect(first.publishedAt).toBe('2026-05-01T12:00:00.000Z')
    expect(first.notes).toContain('Hello world')
    expect(first.durationSec).toBe(0)
    expect(first.signal).toBe('normal')
    expect(first.status).toBe('detected')
    expect(first.entities).toEqual({ people: [], companies: [], themes: [] })
    expect(first.audioUrl).toBeUndefined()
    expect(first.transcriptUrl).toBeUndefined()
  })

  it('gives distinct stable ids per video', () => {
    const eps = parseAtomEntries(xml, 'yt-test')
    expect(eps[0].id).not.toBe(eps[1].id)
    // stable across re-parses
    expect(parseAtomEntries(xml, 'yt-test')[0].id).toBe(eps[0].id)
  })

  it('returns [] for a feed with no entries', () => {
    expect(parseAtomEntries('<feed><title>Empty</title></feed>', 'yt-x')).toEqual([])
  })
})

// `<enclosure>` is not an audio-only tag. Substack-hosted feeds (Sources) enclose
// a hero image on every written post, and an untyped read would send that JPEG to
// Whisper — a real download + upload, then a guaranteed failure.
describe('audioEnclosure', () => {
  it('takes an audio enclosure by declared MIME type', () => {
    expect(audioEnclosure('<item><enclosure url="https://cdn.example.com/ep1.mp3" length="0" type="audio/mpeg"/></item>')).toBe(
      'https://cdn.example.com/ep1.mp3',
    )
  })

  it('ignores image and video enclosures', () => {
    expect(audioEnclosure('<item><enclosure url="https://cdn.example.com/hero.jpeg" length="0" type="image/jpeg"/></item>')).toBe('')
    expect(audioEnclosure('<item><enclosure url="https://cdn.example.com/clip.mp4" type="video/mp4"/></item>')).toBe('')
  })

  it('picks the audio one when an item carries both', () => {
    expect(
      audioEnclosure(
        '<item><enclosure url="https://cdn.example.com/hero.jpg" type="image/jpeg"/><enclosure url="https://cdn.example.com/ep.m4a" type="audio/x-m4a"/></item>',
      ),
    ).toBe('https://cdn.example.com/ep.m4a')
  })

  it('falls back to the file extension when the feed omits `type`', () => {
    expect(audioEnclosure('<item><enclosure url="https://cdn.example.com/ep2.mp3?token=abc"/></item>')).toBe(
      'https://cdn.example.com/ep2.mp3?token=abc',
    )
    expect(audioEnclosure('<item><enclosure url="https://cdn.example.com/hero.png"/></item>')).toBe('')
  })

  it('returns "" when there is no enclosure at all', () => {
    expect(audioEnclosure('<item><title>No media</title></item>')).toBe('')
  })
})

// Sources (sources.news) is a Substack: one RSS feed carrying mostly written
// dispatches plus the occasional audio drop, with the editor's subtitle in
// <description> and the piece itself in <content:encoded> — the inverse of a
// normal podcast feed. Both shapes have to come out right.
describe('parseEpisodes (RSS)', () => {
  const substack = `<rss><channel>
    <item>
      <title><![CDATA[OpenAI closes the Simo chapter]]></title>
      <description><![CDATA[A look back at Fidji Simo's brief, ambitious tenure.]]></description>
      <link>https://sources.news/p/openai-closes-fidji-simo-chapter</link>
      <guid isPermaLink="false">https://sources.news/p/openai-closes-fidji-simo-chapter</guid>
      <pubDate>Fri, 10 Jul 2026 20:28:53 GMT</pubDate>
      <enclosure url="https://substackcdn.com/image/fetch/hero.jpeg" length="0" type="image/jpeg"/>
      <content:encoded><![CDATA[<p>Anyone closely following the reorg knows the real story is org structure, not the headline. ${'Reporting detail. '.repeat(20)}</p>]]></content:encoded>
    </item>
    <item>
      <title><![CDATA[Subscriber Q&amp;A: Live @ Apple WWDC]]></title>
      <description><![CDATA[Taking your questions from Cupertino.]]></description>
      <link>https://sources.news/p/subscriber-q-and-a-live-apple-wwdc</link>
      <pubDate>Tue, 09 Jun 2026 17:02:00 GMT</pubDate>
      <enclosure url="https://api.substack.com/feed/podcast/201179474/6b70.mp3" length="0" type="audio/mpeg"/>
    </item>
  </channel></rss>`

  it('keeps an image enclosure out of audioUrl', () => {
    const [written] = parseEpisodes(substack, 'sources')
    expect(written.audioUrl).toBeUndefined()
    expect(written.sourceUrl).toBe('https://sources.news/p/openai-closes-fidji-simo-chapter')
  })

  it('summarises from <content:encoded> but teases from <description>', () => {
    const [written] = parseEpisodes(substack, 'sources')
    expect(written.notes).toContain('the real story is org structure')
    expect(written.notes!.length).toBeGreaterThan(200)
    // The blurb stays the hand-written précis, not the article's opening line.
    expect(written.blurb).toBe(`A look back at Fidji Simo's brief, ambitious tenure.`)
  })

  it('still picks up the audio drops in the same feed', () => {
    const audio = parseEpisodes(substack, 'sources')[1]
    expect(audio.title).toBe('Subscriber Q&A: Live @ Apple WWDC')
    expect(audio.audioUrl).toBe('https://api.substack.com/feed/podcast/201179474/6b70.mp3')
  })

  it('leaves an ordinary podcast feed unchanged — notes and blurb both from <description>', () => {
    const notes = 'Full show notes. '.repeat(30)
    const rss = `<rss><channel><item>
      <title>Episode 12</title>
      <description><![CDATA[${notes}]]></description>
      <link>https://example.com/ep12</link>
      <pubDate>Wed, 01 Jul 2026 09:00:00 GMT</pubDate>
      <itunes:duration>1:02:03</itunes:duration>
      <enclosure url="https://cdn.example.com/ep12.mp3" type="audio/mpeg"/>
    </item></channel></rss>`
    const [ep] = parseEpisodes(rss, 'demo')
    expect(ep.audioUrl).toBe('https://cdn.example.com/ep12.mp3')
    expect(ep.durationSec).toBe(3723)
    expect(ep.notes).toContain('Full show notes.')
    expect(ep.blurb.startsWith('Full show notes.')).toBe(true)
    expect(ep.blurb.length).toBeLessThanOrEqual(201) // truncated + ellipsis
  })

  it('falls back to the audio URL for sourceUrl when the item has no <link>', () => {
    const rss = `<rss><channel><item>
      <title>Linkless</title>
      <pubDate>Wed, 01 Jul 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/linkless.mp3" type="audio/mpeg"/>
    </item></channel></rss>`
    expect(parseEpisodes(rss, 'demo')[0].sourceUrl).toBe('https://cdn.example.com/linkless.mp3')
  })

  it('gives an image-only item no sourceUrl rather than pointing at the image', () => {
    const rss = `<rss><channel><item>
      <title>Linkless and imageful</title>
      <pubDate>Wed, 01 Jul 2026 09:00:00 GMT</pubDate>
      <enclosure url="https://cdn.example.com/hero.jpeg" type="image/jpeg"/>
    </item></channel></rss>`
    expect(parseEpisodes(rss, 'demo')[0].sourceUrl).toBeUndefined()
  })
})

// Feeds that carry no <itunes:duration> (YouTube Atom, written Substack posts)
// land as durationSec 0 — which must read as "unknown", not "zero minutes long".
describe('formatDuration', () => {
  it('renders known durations', () => {
    expect(formatDuration(2520)).toBe('42m')
    expect(formatDuration(6420)).toBe('1h 47m')
    expect(formatDuration(3599)).toBe('1h 0m') // rounds minutes before splitting
  })

  it('renders an unknown duration as an em dash', () => {
    for (const v of [0, -5, 20, NaN, Infinity]) expect(formatDuration(v), String(v)).toBe('—')
  })
})

// People paste the site, not the feed — it's what's in the address bar. Pasting
// https://sources.news/ used to add a show whose feedUrl WAS that HTML page:
// the page's <title> became the show name and no episode could ever load.
describe('advertisedFeedUrl', () => {
  it('absolutises a relative href against the page URL (Substack)', () => {
    const html = `<head><title>Sources | Alex Heath | Substack</title>
      <link rel="alternate" type="application/rss+xml" href="/feed" title="Sources"/></head>`
    expect(advertisedFeedUrl(html, 'https://sources.news/')).toBe('https://sources.news/feed')
  })

  it('keeps an absolute href, and handles an entity-escaped one', () => {
    expect(
      advertisedFeedUrl('<link rel="alternate" type="application/rss+xml" href="https://cdn.example.com/f.rss"/>', 'https://example.com/blog'),
    ).toBe('https://cdn.example.com/f.rss')
    expect(
      advertisedFeedUrl('<link rel="alternate" type="application/rss+xml" href="/f?a=1&amp;b=2"/>', 'https://example.com/blog/'),
    ).toBe('https://example.com/f?a=1&b=2')
  })

  it('accepts atom and multi-token rel, and resolves a path-relative href', () => {
    expect(advertisedFeedUrl('<link rel="alternate home" type="application/atom+xml" href="atom.xml"/>', 'https://example.com/blog/')).toBe(
      'https://example.com/blog/atom.xml',
    )
  })

  it('ignores link tags that are not feeds', () => {
    for (const tag of [
      '<link rel="stylesheet" href="/app.css"/>',
      '<link rel="canonical" href="https://example.com/"/>',
      '<link rel="alternate" type="text/html" href="/amp"/>',
      '<link rel="alternate" hreflang="fr" href="/fr"/>',
      '<link rel="alternate" type="application/rss+xml"/>', // no href
    ]) {
      expect(advertisedFeedUrl(tag, 'https://example.com/'), tag).toBeNull()
    }
  })

  it('returns null for a page that advertises nothing', () => {
    expect(advertisedFeedUrl('<html><head><title>No feed here</title></head></html>', 'https://example.com/')).toBeNull()
  })

  it('takes the first usable feed link when a page lists several', () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="/feed"/>
      <link rel="alternate" type="application/rss+xml" href="/comments/feed"/>`
    expect(advertisedFeedUrl(html, 'https://example.com/')).toBe('https://example.com/feed')
  })
})

// A pasted /@handle URL only becomes a feed once we know the channel id, and the
// served page states it in exactly these places — nowhere near the top of the
// document. (`"channelId":"…"` is absent from today's markup; the canonical <link>
// carries it, ~700 KB in, which is why the scan streams instead of reading a
// fixed prefix.)
describe('channelIdIn', () => {
  const ID = 'UC9AHywQeW9BOcOl7dg-YMqA'

  it('reads the id from the canonical link, the JSON fields, and a bare channel path', () => {
    expect(channelIdIn(`<link rel="canonical" href="https://www.youtube.com/channel/${ID}">`)).toBe(ID)
    expect(channelIdIn(`{"externalId":"${ID}"}`)).toBe(ID)
    expect(channelIdIn(`{"channelId":"${ID}"}`)).toBe(ID)
    expect(channelIdIn(`<a href="/channel/${ID}/videos">`)).toBe(ID)
  })

  it('prefers the canonical link over an unrelated channel link elsewhere on the page', () => {
    const html = `<a href="/channel/UCsomeOtherChannel">x</a><link rel="canonical" href="https://www.youtube.com/channel/${ID}">`
    expect(channelIdIn(html)).toBe(ID)
  })

  it('returns null when the page states no channel id', () => {
    expect(channelIdIn('<html><head><title>Stratechery - YouTube</title></head></html>')).toBeNull()
    expect(channelIdIn('')).toBeNull()
  })
})

// A podcast on YouTube is usually a playlist (a series on a bigger channel), and
// the Share button hands out playlist URLs — these must resolve to the playlist
// id so Discover tracks the show, not the whole channel.
describe('youtubePlaylistId', () => {
  const PL = 'PLVPkbpccdn996PFFnil1ZETF6RSs7KsLg'

  it('reads the id from a /playlist URL (ignoring tracking params)', () => {
    expect(youtubePlaylistId(`https://youtube.com/playlist?list=${PL}&si=2GX-jJkln2jcwCHY`)).toBe(PL)
    expect(youtubePlaylistId(`https://www.youtube.com/playlist?list=${PL}`)).toBe(PL)
  })

  it('reads the id from watch and short links inside a playlist', () => {
    expect(youtubePlaylistId(`https://www.youtube.com/watch?v=ABC123&list=${PL}&index=4`)).toBe(PL)
    expect(youtubePlaylistId(`https://youtu.be/ABC123?list=${PL}`)).toBe(PL)
  })

  it('rejects session mixes, non-YouTube hosts, and URLs with no list', () => {
    expect(youtubePlaylistId('https://www.youtube.com/watch?v=ABC123&list=RDABC123')).toBeNull()
    expect(youtubePlaylistId(`https://example.com/playlist?list=${PL}`)).toBeNull()
    expect(youtubePlaylistId('https://www.youtube.com/watch?v=ABC123')).toBeNull()
    expect(youtubePlaylistId('https://www.youtube.com/playlist?list=short')).toBeNull()
    expect(youtubePlaylistId('not a url')).toBeNull()
  })
})
