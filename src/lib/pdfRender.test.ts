import { describe, it, expect } from 'vitest'
import { jsPDF } from 'jspdf'
import { weeklyBlocks, episodeBlocks, renderBlocks, runs, Painter, type Block } from './pdfRender'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

const titles = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { k: 'section' }> => b.k === 'section').map((b) => b.title)
const ideas = (blocks: Block[]) => blocks.filter((b): b is Extract<Block, { k: 'idea' }> => b.k === 'idea')

// Render to real PDF bytes (no DOM in the node test runner → the cover falls back
// to a solid fill, the logo is skipped). This exercises every renderer end to end
// and asserts a valid, non-trivial PDF comes out — i.e. nothing throws while drawing.
function toPdfBytes(blocks: Block[]): Uint8Array {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  renderBlocks(new Painter(doc), blocks)
  return new Uint8Array(doc.output('arraybuffer'))
}

describe('runs — **bold** parsing', () => {
  it('splits into word tokens and flags bold spans', () => {
    const t = runs('Plain **bold words** end')
    expect(t.map((x) => x.w)).toEqual(['Plain', 'bold', 'words', 'end'])
    expect(t.map((x) => x.b)).toEqual([false, true, true, false])
  })
})

describe('weeklyBlocks — full house style', () => {
  const blocks = weeklyBlocks(WEEKLY, episodeById, podcastById)

  it('opens with the cover and carries every content section in order', () => {
    expect(blocks[0]).toMatchObject({ k: 'cover', title: 'Weekly Summary', dateRange: WEEKLY.rangeLabel })
    expect(titles(blocks)).toEqual([
      'This Week in Summary',
      'By Show',
      'Top Themes',
      'Mentions',
      'What Was Actually Interesting',
      'Source Episodes',
    ])
  })

  it('renders pitched ideas with their proponent and a dark quote panel', () => {
    const idea = ideas(blocks).find((i) => i.title === 'Long Nvidia (NVDA) into the capex supercycle')
    expect(idea).toBeTruthy()
    expect(idea!.who).toBe('David Sacks')
    expect(blocks.some((b) => b.k === 'quote')).toBe(true)
    expect(blocks.some((b) => b.k === 'themes')).toBe(true)
    expect(blocks.some((b) => b.k === 'mentions')).toBe(true)
  })

  it('links every source episode to its origin (Apple / YouTube / RSS)', () => {
    const src = blocks.find((b): b is Extract<Block, { k: 'sources' }> => b.k === 'sources')
    expect(src).toBeTruthy()
    expect(src!.rows.length).toBeGreaterThan(0)
    for (const r of src!.rows) expect(r.url).toMatch(/^https?:\/\//)
  })

  it('generates a valid, non-trivial PDF', () => {
    const bytes = toPdfBytes(blocks)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(3000)
  })
})

describe('episodeBlocks — episode', () => {
  it('builds the cover + all sections for an episode with ideas, and a real PDF', () => {
    const allin = EPISODES.find((e) => e.id === 'ep-allin-e184')!
    const blocks = episodeBlocks(allin, podcastById(allin.podcastId))
    expect(blocks[0]).toMatchObject({ k: 'cover', title: allin.title })
    expect(titles(blocks)).toEqual(['AI Summary', 'Ideas Pitched', 'Highlights', 'Q&A'])
    const bytes = toPdfBytes(blocks)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('omits the Ideas section when an episode pitched nothing', () => {
    const acquired = EPISODES.find((e) => e.id === 'ep-acquired-tsmc')!
    const blocks = episodeBlocks(acquired, podcastById(acquired.podcastId))
    expect(titles(blocks)).not.toContain('Ideas Pitched')
  })
})
