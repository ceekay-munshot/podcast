import type { Episode, Podcast, WeeklyIdea, WeeklyShowDigest, WeeklySummary } from './types'
import { cover, docFooter, downloadWord, esc, inline, leadParagraph, pill, sanitizeFilename, section, tag, wordShell } from './exportDoc'
import { groupQuantByEpisode } from './weeklyQuant'

// Builds the institution-grade Weekly Summary Word document: a navy cover, then a
// BY-SHOW body (each show's pitched ideas · key takeaways · questions), cross-show
// Themes / Mentions, the dark "interesting" quote panel, and a source-episode table.

type ById<T> = (id: string) => T | undefined
type TagColor = 'navy' | 'gold' | 'slate'

// Stable navy/gold/slate per show name (mirrors the design kit's palette cycling).
function showTagColors(names: string[]): (name: string) => TagColor {
  const palette: TagColor[] = ['navy', 'gold', 'slate']
  const map = new Map<string, TagColor>()
  let i = 0
  for (const n of names) {
    if (n && !map.has(n)) map.set(n, palette[i++ % palette.length])
  }
  return (n) => map.get(n) ?? 'slate'
}

// One pitched idea: the call (+ category badge), who pitched it, gold-diamond thesis.
function ideaBlock(idea: WeeklyIdea): string {
  const kind = idea.kind ? `<span class="idea-kind">${esc(idea.kind)}</span>` : ''
  const who = idea.proponent && idea.proponent !== '—' ? `<p class="idea-who">Pitched by <b>${esc(idea.proponent)}</b></p>` : ''
  const thesis = idea.thesis.length
    ? `<ul class="thesis">${idea.thesis.map((t) => `<li><span class="di">&#9670;</span>${inline(t)}</li>`).join('')}</ul>`
    : ''
  return `<div class="idea"><div class="idea-title">${kind}${esc(idea.idea)}</div>${who}${thesis}</div>`
}

// Two-column question panel.
function questionGrid(qs: string[]): string {
  const mid = Math.ceil(qs.length / 2)
  const col = (arr: string[]) => arr.map((q, i) => `<p class="q${i === arr.length - 1 ? ' last' : ''}">${inline(q)}</p>`).join('')
  const right = qs.slice(mid)
  return `<div class="qs"><table class="qgrid" role="presentation" cellpadding="0" cellspacing="0"><tr><td>${col(
    qs.slice(0, mid),
  )}</td><td>${right.length ? col(right) : ''}</td></tr></table></div>`
}

// One show's mini-digest: ideas pitched, then key takeaways, then open questions.
function showBlock(d: WeeklyShowDigest): string {
  const count = `${d.episodeCount} episode${d.episodeCount === 1 ? '' : 's'}`
  const head = `<p class="show-head"><span class="show-name">${esc(d.show)}</span> ${pill(count)}</p>`
  const ideas = d.ideas.length ? `<p class="subhead">Ideas Pitched</p>${d.ideas.map(ideaBlock).join('')}` : ''
  const takeaways = d.takeaways.length
    ? `<p class="subhead">Key Takeaways</p><ul class="tlist">${d.takeaways
        .map((t) => `<li><span class="sq">&#9642;</span><span class="ti">${esc(t.title)}.</span> ${inline(t.detail)}</li>`)
        .join('')}</ul>`
    : ''
  const questions = d.questions.length ? `<p class="subhead">Questions</p>${questionGrid(d.questions)}` : ''
  return `<div class="show-block">${head}${ideas}${takeaways}${questions}</div>`
}

export function weeklyToWord(weekly: WeeklySummary, episodeById: ById<Episode>, podcastById: ById<Podcast>, logo?: string): string {
  const overview = weekly.overview.length
    ? `<div class="lead">${weekly.overview
        .map((p, i) => `<p${i === weekly.overview.length - 1 ? ' class="last"' : ''}>${i === 0 ? leadParagraph(p) : inline(p)}</p>`)
        .join('')}</div>`
    : ''

  const showsBody = (weekly.shows ?? []).map(showBlock).join('')

  // Guidepoint layers — Key Points (claim-first, cross-episode) is the primary body
  // when present; the by-show breakdown is the no-AI fallback.
  const keyThemes = weekly.keyThemes ?? []
  const keyPointsBody = keyThemes.length
    ? keyThemes
        .map(
          (t) =>
            `<p class="kpt-heading">${esc(t.heading)}</p><ul class="tlist">${t.points
              .map((p) => `<li><span class="sq">&#9642;</span>${inline(p)}</li>`)
              .join('')}</ul>`,
        )
        .join('')
    : ''

  // Grouped by source episode so the numbers don't read as one mixed list.
  const quantBody = (weekly.quantTable ?? []).length
    ? groupQuantByEpisode(weekly.quantTable ?? [], weekly.citations ?? [])
        .map((g) => {
          const heading = g.label ? `<p class="kpt-heading">${esc(g.label)}</p>` : ''
          const rows = g.rows
            .map((q, i) => `<tr${i % 2 ? ' class="zebra"' : ''}><td>${esc(q.metric)}</td><td class="num">${esc(q.value)}</td><td class="ctx">${esc(q.context)}</td></tr>`)
            .join('')
          return `${heading}<table class="dt"><tr><th>Metric</th><th class="r">Value</th><th>Context</th></tr>${rows}</table>`
        })
        .join('')
    : ''

  const comparisonBody = (weekly.comparison ?? []).length
    ? `<table class="dt"><tr><th>Transcript</th><th>Voice</th><th class="r">Date</th><th>Key Points</th></tr>${(weekly.comparison ?? [])
        .map(
          (c, i) =>
            `<tr${i % 2 ? ' class="zebra"' : ''}><td>${esc(c.index ? `[${c.index}] ` : '')}${esc(c.source)}</td><td>${esc(c.speaker)}</td><td class="num">${esc(c.date)}</td><td class="ctx">${esc(c.keyPoints)}</td></tr>`,
        )
        .join('')}</table>`
    : ''

  const themes = chipsRow(weekly.topThemes.map((t) => t.label))

  const interesting = weekly.interesting.quote
    ? `<div class="interesting"><div class="int-mark">&#8220;</div>${
        weekly.interesting.title ? `<div class="int-qt">${esc(weekly.interesting.title)}</div>` : ''
      }<div class="int-ql">${esc(weekly.interesting.quote)}</div><div class="int-at"><span class="who">${esc(
        weekly.interesting.speaker,
      )}</span> <span class="role">${esc(weekly.interesting.role)}</span></div></div>`
    : ''

  const contradictions = weekly.contradictions.length
    ? weekly.contradictions.map((c) => `<p class="callout">${inline(c)}</p>`).join('')
    : ''

  const mcol = (label: string, items: string[]) =>
    `<p class="mh">${esc(label)}</p>${
      items.length ? items.map((it) => `<span class="mchip">${esc(it)}</span> `).join('') : '<span class="mempty">&mdash;</span>'
    }`
  const mentions =
    weekly.mentions.people.length || weekly.mentions.companies.length
      ? `<table class="cols" role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td>${mcol('People', weekly.mentions.people)}</td>
          <td class="right">${mcol('Companies', weekly.mentions.companies)}</td>
        </tr></table>`
      : ''

  const sources = weekly.sourceEpisodeIds.map(episodeById).filter((e): e is Episode => Boolean(e))
  const colorFor = showTagColors(sources.map((e) => podcastById(e.podcastId)?.title ?? ''))
  const sourcesBody = sources.length
    ? `<table class="srcs" role="presentation" cellpadding="0" cellspacing="0"><thead><tr><th>Episode</th><th class="r">Show</th></tr></thead><tbody>${sources
        .map((ep, i) => {
          const show = podcastById(ep.podcastId)?.title ?? ''
          return `<tr${i % 2 === 1 ? ' class="zebra"' : ''}><td>${esc(ep.title)}</td><td class="r">${show ? tag(show, colorFor(show)) : ''}</td></tr>`
        })
        .join('')}</tbody></table>`
    : ''

  const inner = `${cover({
    eyebrow: 'AI Podcast Intelligence',
    kicker: 'Weekly Intelligence',
    title: 'Weekly Summary',
    dateRange: weekly.rangeLabel,
    chips: [`${weekly.episodeCount} episode${weekly.episodeCount === 1 ? '' : 's'}`, `${weekly.readMinutes} min read`],
    logo,
    footerLeft: 'Generated by <b>Munshot</b> &middot; AI podcast intelligence',
  })}
      ${(() => {
        // Number each section in order, skipping empties; demote by-show + themes to
        // the no-AI fallback so the synthesised Guidepoint body leads when present.
        const synthesised = keyThemes.length > 0
        const secs: string[] = []
        const sec = (title: string, body: string) => {
          if (body) secs.push(section(String(secs.length + 1).padStart(2, '0'), title, body))
        }
        sec('Overview', overview)
        sec('Key Points', keyPointsBody)
        sec('Quantitative Summary', quantBody)
        sec('Comparison Across Sources', comparisonBody)
        if (!synthesised) sec('By Show', showsBody)
        if (!synthesised) sec('Top Themes', themes)
        sec('Mentions', mentions)
        sec('What Was Actually Interesting', interesting)
        sec('Contradictions & Disagreements', contradictions)
        sec('Sources', sourcesBody)
        return secs.join('\n      ')
      })()}
      ${docFooter('Generated by <b>Munshot</b> &middot; AI podcast intelligence', weekly.rangeLabel)}`

  return wordShell(`Munshot Weekly — ${weekly.rangeLabel}`, inner)
}

// Top Themes as gold mono chips.
function chipsRow(items: string[]): string {
  if (!items.length) return ''
  return `<p class="chips">${items.map((i) => `<span class="chip">${esc(i)}</span>`).join(' ')}</p>`
}

export async function downloadWeekly(weekly: WeeklySummary, episodeById: ById<Episode>, podcastById: ById<Podcast>): Promise<void> {
  const { MUNSHOT_LOGO } = await import('./brandLogo')
  downloadWord(`Munshot Weekly — ${sanitizeFilename(weekly.rangeLabel)}.doc`, weeklyToWord(weekly, episodeById, podcastById, MUNSHOT_LOGO))
}
