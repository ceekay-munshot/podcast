import { describe, it, expect } from 'vitest'
import { weeklyToPdfHtml, summaryToPdfHtml, injectPrintLauncher, inlineFonts } from './pdfDoc'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

// The PDF carries the FULL design kit — gradients + self-hosted fonts the Word .doc
// can't. These pin that the rich cover, fonts, and every content section are present
// in the generated print HTML (the browser turns it into the PDF).

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

describe('weeklyToPdfHtml — full house style', () => {
  const html = weeklyToPdfHtml(WEEKLY, episodeById, podcastById)

  it('embeds the kit fonts and the gradient cover', () => {
    expect(html).toContain('@font-face')
    expect(html).toContain('/fonts/Fraunces-600.woff2')
    expect(html).toContain('/fonts/IBMPlexMono-400.woff2')
    expect(html).toContain("font-family:'Fraunces'")
    expect(html).toContain('class="cover"')
    expect(html).toContain('linear-gradient') // dark navy cover
    expect(html).toContain('radial-gradient') // gold glow
    expect(html).toContain('class="c-title"')
    expect(html).toContain('Weekly Summary')
  })

  it('renders every content section', () => {
    expect(html).toContain('This Week in Summary')
    expect(html).toContain('By Show')
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Long Nvidia (NVDA) into the capex supercycle')
    expect(html).toContain('Pitched by <b>David Sacks</b>')
    expect(html).toContain('class="interesting"') // dark quote panel
    expect(html).toContain('class="srcs"') // sources table
    expect(html).toContain('tag-') // colour-coded show tags
    expect(html).toContain('Top Themes')
    expect(html).toContain('Mentions')
  })
})

describe('summaryToPdfHtml — episode', () => {
  it('builds the cover + all sections for an episode with ideas', () => {
    const allin = EPISODES.find((e) => e.id === 'ep-allin-e184')!
    const html = summaryToPdfHtml(allin, podcastById(allin.podcastId))
    expect(html).toContain('class="cover"')
    expect(html).toContain('All-In') // eyebrow = show · author
    expect(html).toContain(allin.title)
    expect(html).toContain('AI Summary')
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Highlights')
    expect(html).toContain('Q&amp;A')
  })

  it('omits the Ideas section when an episode pitched nothing', () => {
    const acquired = EPISODES.find((e) => e.id === 'ep-acquired-tsmc')!
    const html = summaryToPdfHtml(acquired, podcastById(acquired.podcastId))
    expect(html).not.toContain('Ideas Pitched')
  })
})

// The embedded path can't print (the dashboard iframe lacks allow-modals), so it
// downloads a self-contained, print-ready file instead. These pin the two pure
// transforms that make that file work everywhere — without fail.
describe('injectPrintLauncher — embedded download is print-ready', () => {
  const out = injectPrintLauncher('<!doctype html><html><body><div class="cover"></div></body></html>')

  it('adds a Save-as-PDF button that opens the print dialog', () => {
    expect(out).toContain('Save as PDF')
    expect(out).toContain('onclick="window.print()"')
  })

  it('auto-prints on open but hides the button from the printout', () => {
    expect(out).toContain('window.print()')
    expect(out).toContain('@media print')
    expect(out).toContain('.pdf-actionbar{display:none!important;}')
  })

  it('injects before </body> so the original document is intact', () => {
    expect(out).toContain('<div class="cover"></div>')
    expect(out.indexOf('pdf-actionbar')).toBeLessThan(out.indexOf('</body>'))
  })
})

describe('inlineFonts — self-contained, offline-faithful', () => {
  const ok = (async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer })) as unknown as typeof fetch

  it('replaces every /fonts/*.woff2 url with an inlined data URI', async () => {
    const html = weeklyToPdfHtml(WEEKLY, episodeById, podcastById)
    const out = await inlineFonts(html, ok)
    expect(out).not.toContain('/fonts/Fraunces-600.woff2')
    expect(out).not.toContain('/fonts/IBMPlexMono-400.woff2')
    expect(out).toContain('data:font/woff2;base64,')
  })

  it('leaves a url untouched (graceful) when its fetch fails', async () => {
    const bad = (async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })) as unknown as typeof fetch
    const out = await inlineFonts('<style>src:url(/fonts/Inter-400.woff2)</style>', bad)
    expect(out).toContain('/fonts/Inter-400.woff2')
    expect(out).not.toContain('data:font/woff2')
  })
})
