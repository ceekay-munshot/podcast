import { describe, it, expect } from 'vitest'
import { weeklyToWord } from './exportWeekly'
import { summaryToWord } from './exportSummary'
import { EPISODES, PODCASTS, WEEKLY } from './mock-data'

// The exported Word doc is the user-facing artifact. These smoke tests pin both the
// content (pitched ideas with their thesis, organized by show) and the institution-
// grade house style (navy cover, gold/serif palette, the dark quote panel).

const episodeById = (id: string) => EPISODES.find((e) => e.id === id)
const podcastById = (id: string) => PODCASTS.find((p) => p.id === id)

describe('weeklyToWord — institution-grade weekly doc', () => {
  const html = weeklyToWord(WEEKLY, episodeById, podcastById)

  it('opens with the navy house-style cover', () => {
    expect(html).toContain('class="cover"')
    expect(html).toContain('AI Podcast Intelligence') // eyebrow
    expect(html).toContain('class="cv-title"')
    expect(html).toContain('Weekly Summary')
    // House palette + serif display role are present in the stylesheet.
    expect(html).toContain('#b8902f') // gold
    expect(html).toContain('#14233c') // navy cover
    expect(html).toContain('Georgia')
  })

  it('renders the By Show body with each show as a sub-block', () => {
    expect(html).toContain('By Show')
    expect(html).toContain('class="show-head"')
    expect(html).toContain('All-In')
    expect(html).toContain('Odd Lots')
  })

  it('surfaces the pitched ideas with proponent and thesis', () => {
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Long Nvidia (NVDA) into the capex supercycle')
    expect(html).toContain('Pitched by <b>David Sacks</b>')
    expect(html).toContain('<ul class="thesis">')
    expect(html).toContain('<strong>power-constrained</strong>') // gold emphasis from **bold**
    expect(html).toContain('class="idea-kind">stock</span>') // category badge
  })

  it('keeps cross-show themes/mentions, the dark quote panel, and a sources table', () => {
    expect(html).toContain('Top Themes')
    expect(html).toContain('Mentions')
    expect(html).toContain('class="interesting"') // dark navy quote panel
    expect(html).toContain('class="srcs"') // sources table
    expect(html).toContain('tag-') // colour-coded show tags
  })
})

describe('summaryToWord — institution-grade episode doc', () => {
  it('opens with a cover naming the show and includes Ideas Pitched', () => {
    const allin = EPISODES.find((e) => e.id === 'ep-allin-e184')!
    const html = summaryToWord(allin, podcastById(allin.podcastId))
    expect(html).toContain('class="cover"')
    expect(html).toContain('All-In') // eyebrow = show · author
    expect(html).toContain(allin.title)
    expect(html).toContain('Ideas Pitched')
    expect(html).toContain('Long Nvidia (NVDA) into the capex supercycle')
    expect(html).toContain('Pitched by <b>David Sacks</b>')
  })

  it('omits the Ideas section for an episode with no pitches', () => {
    const acquired = EPISODES.find((e) => e.id === 'ep-acquired-tsmc')!
    const html = summaryToWord(acquired, podcastById(acquired.podcastId))
    expect(html).not.toContain('Ideas Pitched')
  })
})
