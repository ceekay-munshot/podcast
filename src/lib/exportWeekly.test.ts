import { describe, it, expect } from 'vitest'
import { weeklyToWord } from './exportWeekly'
import { summaryToWord } from './exportSummary'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

// The exported Word doc is the user-facing artifact. These smoke tests pin the
// regression the weekly redesign fixes: pitched ideas (with their thesis) must be
// present and organized by show — not abstracted away.

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

describe('weeklyToWord — by-show digest with pitched ideas', () => {
  const html = weeklyToWord(WEEKLY, episodeById, podcastById)

  it('renders the By Show section with each show as a sub-block', () => {
    expect(html).toContain('By Show')
    expect(html).toContain('class="show-head"')
    expect(html).toContain('All-In')
    expect(html).toContain('Odd Lots')
  })

  it('surfaces the pitched ideas with proponent and thesis', () => {
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Long Nvidia (NVDA) into the capex supercycle')
    expect(html).toContain('Pitched by David Sacks')
    // Thesis bullets are rendered, with **bold** promoted to <strong>.
    expect(html).toContain('<ul class="thesis">')
    expect(html).toContain('<strong>power-constrained</strong>')
    // The category badge is shown.
    expect(html).toContain('class="idea-kind">stock</span>')
  })

  it('keeps themes and mentions as cross-show sections', () => {
    expect(html).toContain('Top Themes')
    expect(html).toContain('Mentions')
  })
})

describe('summaryToWord — per-episode Ideas Pitched section', () => {
  it('includes the Ideas Pitched section for an episode that pitched ideas', () => {
    const allin = EPISODES.find((e) => e.id === 'ep-allin-e184')!
    const html = summaryToWord(allin, podcastById(allin.podcastId))
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Long Nvidia (NVDA) into the capex supercycle')
    expect(html).toContain('Pitched by David Sacks')
  })

  it('omits the Ideas section for an episode with no pitches', () => {
    const acquired = EPISODES.find((e) => e.id === 'ep-acquired-tsmc')!
    const html = summaryToWord(acquired, podcastById(acquired.podcastId))
    // The section() helper drops empty sections, so the heading must be absent.
    expect(html).not.toContain('Ideas Pitched')
  })
})
