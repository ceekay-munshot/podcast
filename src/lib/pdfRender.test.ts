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

describe('weeklyBlocks — Guidepoint house style', () => {
  const blocks = weeklyBlocks(WEEKLY, episodeById, podcastById)

  it('opens with the cover + table of contents, then the synthesised sections in order', () => {
    expect(blocks[0]).toMatchObject({ k: 'cover', title: 'Weekly Summary', dateRange: WEEKLY.rangeLabel })
    expect(blocks[1].k).toBe('toc')
    expect(titles(blocks)).toEqual(['Overview', 'Key Points', 'Quantitative Summary', 'Comparison Across Sources', 'Ideas Pitched', 'Sources'])
  })

  it('carries the TOC, the quant + comparison tables, and the pitched ideas', () => {
    // The TOC lists exactly the emitted sections.
    const toc = blocks.find((b): b is Extract<Block, { k: 'toc' }> => b.k === 'toc')!
    expect(toc.rows.map((r) => r.title)).toEqual(titles(blocks))
    // Two data tables (quant + comparison) with header columns + rows.
    const tables = blocks.filter((b): b is Extract<Block, { k: 'table' }> => b.k === 'table')
    expect(tables).toHaveLength(2)
    expect(tables[0].rows.length).toBeGreaterThan(0)
    // Pitched ideas flattened across shows.
    const idea = ideas(blocks).find((i) => i.title === 'Long Nvidia (NVDA) into the capex supercycle')
    expect(idea?.who).toBe('David Sacks')
    expect(blocks.some((b) => b.k === 'sources' && b.rows.length > 0)).toBe(true)
  })

  it('generates a valid, non-trivial PDF (two-pass render, no throws)', () => {
    const bytes = toPdfBytes(blocks)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(3000)
  })

  it('falls back to the By-Show body when there are no synthesised key themes', () => {
    const noThemes = weeklyBlocks({ ...WEEKLY, keyThemes: [], quantTable: [], comparison: [] }, episodeById, podcastById)
    expect(titles(noThemes)).toContain('By Show')
    expect(titles(noThemes)).not.toContain('Key Points')
  })
})

describe('episodeBlocks — episode', () => {
  it('builds the cover, TOC, and all sections incl. the investable insight + key numbers', () => {
    const allin = EPISODES.find((e) => e.id === 'ep-allin-e184')!
    const blocks = episodeBlocks(allin, podcastById(allin.podcastId))
    expect(blocks[0]).toMatchObject({ k: 'cover', title: allin.title })
    expect(blocks[1].k).toBe('toc')
    expect(titles(blocks)).toEqual(['AI Summary', 'Investable Insight', 'Key Numbers', 'Ideas Pitched', 'Highlights', 'Q&A'])
    expect(blocks.some((b) => b.k === 'insight')).toBe(true)
    const bytes = toPdfBytes(blocks)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
  })

  it('omits the Ideas + Insight sections when an episode pitched nothing', () => {
    const acquired = EPISODES.find((e) => e.id === 'ep-acquired-tsmc')!
    const blocks = episodeBlocks(acquired, podcastById(acquired.podcastId))
    expect(titles(blocks)).not.toContain('Ideas Pitched')
    expect(titles(blocks)).not.toContain('Investable Insight')
  })
})

describe('runs — inline [n] citations', () => {
  it('splits citation markers into their own gold tokens', () => {
    const t = runs('Budgets shift to OTT [1] [3].')
    const cites = t.filter((x) => x.cite).map((x) => x.w)
    expect(cites).toEqual(['[1]', '[3]'])
    // an attached marker still separates from its word
    expect(runs('share[4]').map((x) => x.w)).toEqual(['share', '[4]'])
  })
})
