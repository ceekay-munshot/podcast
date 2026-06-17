import type { Episode, Podcast, WeeklyIdea, WeeklyShowDigest, WeeklySummary } from './types'
import { esc, inline, sanitizeFilename } from './exportDoc'
import { formatDuration, longDate } from './format'

// ─────────────────────────────────────────────────────────────────────────────
// PDF export — the FULL Munshot house style, ported faithfully from the design kit
// (mkdoc.py). Unlike the Word `.doc` (which Word's HTML engine strips down), this is
// rendered by the user's own browser, so it keeps everything: the dark gradient
// cover with the gold glow, the Fraunces/Inter/IBM Plex Mono fonts (self-hosted from
// /fonts), gold section rules, drop caps, diamond bullets, two-column questions, the
// dark quote panel, and the zebra source table. We hand the styled HTML to a hidden
// iframe and call print() → the user saves a pixel-faithful PDF.
//
// CSS variables, gradients, and pseudo-elements are all used here on purpose — the
// browser supports them (Word did not). Colours: navy #1a2b4a · gold #b8902f.
// ─────────────────────────────────────────────────────────────────────────────

type ById<T> = (id: string) => T | undefined
type TagColor = 'navy' | 'gold' | 'slate'

const LOGO = '/munshot-logo.png'

const FONT_FACES = (
  [
    ['Fraunces', [400, 500, 600, 900], 'Fraunces'],
    ['Inter', [400, 500, 600, 700, 800], 'Inter'],
    ['IBM Plex Mono', [400, 500, 600], 'IBMPlexMono'],
  ] as const
)
  .flatMap(([family, weights, file]) =>
    weights.map(
      (w) =>
        `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/${file}-${w}.woff2) format('woff2');}`,
    ),
  )
  .join('\n')

// The house stylesheet — ported from mkdoc.py _css(), plus episode-only blocks
// (highlights, Q&A) and interior keyword chips, and @page rules for a full-bleed
// cover + margined interior.
const PDF_CSS = `${FONT_FACES}
*{margin:0;padding:0;box-sizing:border-box;}
:root{
 --navy:#1a2b4a; --navy2:#142238; --navy3:#0c1626; --ink:#0a1322;
 --gold:#b8902f; --gold-b:#cea344; --gold-pale:#e7cf93; --gold-tint:#faf6ea;
 --slate:#54606e; --slate-l:#828c99; --paper:#ffffff;
 --panel:#f6f8fb; --panel2:#eef2f7; --line:#e6eaf1; --line2:#d4dbe6;
}
@page{size:A4;margin:15mm 16mm;}
@page cover{size:A4;margin:0;}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{font-family:'Inter',sans-serif;color:var(--slate);font-size:9.4pt;line-height:1.6;
 font-feature-settings:"kern" 1,"liga" 1;-webkit-font-smoothing:antialiased;}

/* ===== COVER ===== */
.cover{page:cover;break-after:always;position:relative;width:210mm;height:297mm;overflow:hidden;color:#eaf0f8;
 background:
   radial-gradient(120% 80% at 50% 30%, rgba(184,144,47,.16) 0%, rgba(184,144,47,0) 42%),
   radial-gradient(140% 120% at 80% 110%, rgba(30,55,95,.55) 0%, rgba(10,18,34,0) 55%),
   linear-gradient(158deg,#0a1322 0%,#14233c 46%,#0b182c 100%);}
.cover .frame{position:absolute;inset:11mm;border:1px solid rgba(184,144,47,.34);}
.cover .corner-tr,.cover .corner-bl{position:absolute;width:18px;height:18px;border:1.4px solid var(--gold-b);z-index:3;}
.wm{position:absolute;right:-58mm;bottom:-46mm;width:220mm;height:220mm;opacity:.05;
 background:url(${LOGO}) no-repeat center/contain;}
.cover .inner{position:absolute;inset:11mm;padding:14mm 16mm;display:flex;flex-direction:column;}
.c-top{display:flex;align-items:center;justify-content:space-between;}
.c-brand{display:flex;align-items:center;gap:11px;}
.c-brand img{width:13mm;height:13mm;display:block;}
.c-brand .nm{font-family:'Fraunces',serif;font-weight:600;font-size:17pt;letter-spacing:.06em;color:#f3f6fb;}
.c-kick{font-family:'Inter';font-weight:600;font-size:8pt;letter-spacing:.34em;color:var(--gold-pale);text-transform:uppercase;}
.c-toprule{height:1px;background:linear-gradient(90deg,rgba(184,144,47,.7),rgba(184,144,47,.08));margin-top:9mm;}
.c-hero{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;}
.c-hero .glow{position:relative;}
.c-hero .glow:before{content:"";position:absolute;inset:-30px;border-radius:50%;
 background:radial-gradient(circle,rgba(184,144,47,.30),rgba(184,144,47,0) 68%);}
.c-hero img{width:44mm;height:44mm;display:block;position:relative;filter:drop-shadow(0 8px 26px rgba(184,144,47,.30));}
.c-eyebrow{margin-top:11mm;font-family:'Inter';font-weight:600;font-size:8.5pt;letter-spacing:.42em;text-transform:uppercase;color:var(--gold-b);}
.c-title{font-family:'Fraunces',serif;font-weight:900;font-size:50pt;line-height:1.0;margin-top:7px;letter-spacing:-.012em;color:#f4eedf;}
.c-date{font-family:'Fraunces',serif;font-style:italic;font-weight:400;font-size:18pt;color:var(--gold-pale);margin-top:14px;}
.c-meta{margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:center;}
.c-chip{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:7.6pt;letter-spacing:.18em;text-transform:uppercase;
 color:#cdd7e6;border:1px solid rgba(184,144,47,.42);padding:5px 13px;border-radius:30px;background:rgba(255,255,255,.02);}
.c-dot{color:#5c6a80;}
.c-bot{display:flex;align-items:center;justify-content:space-between;}
.c-botrule{height:1px;background:linear-gradient(90deg,rgba(184,144,47,.08),rgba(184,144,47,.7));margin-bottom:8mm;}
.c-bl{font-family:'Inter';font-weight:500;font-size:7.6pt;letter-spacing:.06em;color:#9fb0c6;}
.c-bl b{color:#e7eef7;font-weight:700;}
.c-br{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:7.4pt;letter-spacing:.16em;color:var(--gold-pale);text-transform:uppercase;}

/* ===== INTERIOR ===== */
.sec{margin-bottom:13pt;}
.sec-head{display:flex;align-items:baseline;gap:13px;margin-bottom:9pt;break-after:avoid;}
.sec-num{font-family:'Fraunces',serif;font-weight:900;font-size:23pt;line-height:.8;color:var(--gold);letter-spacing:-.02em;flex:none;}
.sec-title{font-family:'Fraunces',serif;font-weight:600;font-size:15.5pt;color:var(--navy);letter-spacing:-.01em;flex:none;}
.sec-rule{flex:1;height:1px;background:linear-gradient(90deg,var(--gold) 0%,rgba(184,144,47,.10) 100%);align-self:center;margin-top:4px;}

.lead{position:relative;background:var(--gold-tint);border-left:3px solid var(--gold);border-radius:0 8px 8px 0;padding:13pt 16pt 11pt 16pt;}
.lead p{font-size:10.2pt;line-height:1.62;color:#2b3850;margin-bottom:8pt;}
.lead p:last-child{margin-bottom:0;}
.lead p.first:first-letter{font-family:'Fraunces',serif;font-weight:900;font-size:30pt;line-height:.82;float:left;color:var(--gold);padding:3px 8px 0 0;}
.lead strong,.idea strong,.tlist strong,.moment strong,.qa strong{color:var(--gold);font-weight:600;}

.show{margin-bottom:11pt;}
.show-head{display:flex;align-items:baseline;gap:10px;border-bottom:1px solid var(--line2);padding-bottom:5pt;margin-bottom:8pt;break-after:avoid;}
.show-name{font-family:'Fraunces',serif;font-weight:600;font-size:13.5pt;color:var(--navy);}
.show-count{font-family:'Inter';font-weight:600;font-size:7.2pt;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);
 background:var(--gold-tint);border:1px solid rgba(184,144,47,.30);padding:2px 9px;border-radius:20px;}
.show-spacer{flex:1;}

.subhead{font-family:'Inter';font-weight:700;font-size:7.8pt;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);
 display:flex;align-items:center;gap:7px;margin:9pt 0 6pt;break-after:avoid;}
.subhead:before{content:"";width:14px;height:2px;background:var(--gold);display:inline-block;}

.idea{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:7px;
 padding:9pt 12pt 8pt;margin-bottom:7pt;break-inside:avoid;}
.idea-title{font-family:'Fraunces',serif;font-weight:600;font-size:11.4pt;color:var(--navy);line-height:1.2;}
.idea-kind{font-family:'Inter';font-weight:700;font-size:6.8pt;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);
 background:#fff;border:1px solid rgba(184,144,47,.4);padding:1px 6px;border-radius:4px;margin-right:7px;vertical-align:2px;}
.idea-who{display:inline-block;font-family:'Inter';font-weight:600;font-size:7.3pt;color:var(--slate);background:#fff;
 border:1px solid var(--line2);padding:2px 9px;border-radius:20px;margin:5pt 0 6pt;}
.idea-who b{color:var(--navy);font-weight:700;}
ul.thesis{list-style:none;}
ul.thesis li{position:relative;padding-left:16px;font-size:9.2pt;line-height:1.5;color:#41506a;margin-bottom:3pt;}
ul.thesis li:last-child{margin-bottom:0;}
ul.thesis li:before{content:"";position:absolute;left:0;top:6.2px;width:5px;height:5px;background:var(--gold);transform:rotate(45deg);}

ul.tlist{list-style:none;}
ul.tlist li{position:relative;padding-left:18px;font-size:9.3pt;line-height:1.55;color:#42506a;margin-bottom:6pt;}
ul.tlist li:before{content:"";position:absolute;left:0;top:5.8px;width:6px;height:6px;background:var(--gold);border-radius:1px;}
.tlist .ti{font-family:'Inter';font-weight:700;color:var(--navy);}

.qs{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:10pt 13pt;break-inside:avoid;}
.qgrid{column-count:2;column-gap:22px;}
.qgrid .q{position:relative;padding-left:15px;font-size:8.9pt;line-height:1.45;color:#46566f;font-style:italic;margin-bottom:6pt;
 break-inside:avoid;-webkit-column-break-inside:avoid;}
.qgrid .q:last-child{margin-bottom:0;}
.qgrid .q:before{content:"";position:absolute;left:0;top:2px;bottom:2px;width:2px;background:var(--gold-b);border-radius:2px;}

.mentions{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;break-inside:avoid;}
.mcol{padding:11pt 14pt;}
.mcol+.mcol{border-left:1px solid var(--line);}
.mh{font-family:'Inter';font-weight:700;font-size:8pt;letter-spacing:.18em;text-transform:uppercase;color:var(--navy);
 padding-bottom:5pt;border-bottom:1.5px solid var(--gold);margin-bottom:8pt;}
.mempty{font-size:11pt;color:var(--slate-l);}
.mchip{display:inline-block;font-family:'Inter';font-weight:600;font-size:8pt;color:var(--navy);background:var(--panel2);
 border:1px solid var(--line2);border-radius:20px;padding:3px 10px;margin:0 5pt 5pt 0;}

.kwrap{display:flex;flex-wrap:wrap;gap:7px;}
.kw{font-family:'IBM Plex Mono',monospace;font-size:8pt;letter-spacing:.06em;text-transform:uppercase;color:var(--navy);
 background:var(--gold-tint);border:1px solid rgba(184,144,47,.35);padding:4px 11px;border-radius:20px;}

.interesting{position:relative;border-radius:13px;padding:20pt 22pt 18pt 26pt;color:#e7eef8;overflow:hidden;break-inside:avoid;
 background:radial-gradient(120% 130% at 88% 12%,rgba(184,144,47,.16),rgba(184,144,47,0) 46%),linear-gradient(150deg,#13223a,#0c1729 90%);
 border:1px solid rgba(184,144,47,.28);}
.interesting:before{content:"\\201C";position:absolute;left:8px;top:-14px;font-family:'Fraunces',serif;font-weight:900;font-size:96pt;color:rgba(184,144,47,.30);line-height:1;}
.int-qt{font-family:'Fraunces',serif;font-weight:600;font-size:15pt;color:var(--gold-pale);margin-bottom:8pt;position:relative;}
.int-ql{font-family:'Fraunces',serif;font-style:italic;font-weight:400;font-size:12.4pt;line-height:1.5;color:#dde6f2;position:relative;}
.int-at{margin-top:12pt;display:flex;align-items:center;gap:9px;font-family:'Inter';position:relative;flex-wrap:wrap;}
.int-at .dot{width:5px;height:5px;background:var(--gold-b);transform:rotate(45deg);}
.int-at .who{font-weight:700;font-size:8.4pt;letter-spacing:.04em;color:var(--gold-b);}
.int-at .role{font-weight:400;font-size:8pt;color:#9fb1c8;}

/* episode highlights */
.moment{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:7px;padding:9pt 12pt 8pt;margin-bottom:7pt;break-inside:avoid;}
.m-top{display:flex;align-items:baseline;gap:9px;}
.ts{font-family:'IBM Plex Mono',monospace;font-weight:500;font-size:7.4pt;letter-spacing:.06em;color:var(--gold);background:var(--gold-tint);border:1px solid rgba(184,144,47,.3);padding:1.5px 7px;border-radius:20px;flex:none;}
.m-star{color:var(--gold);font-size:9pt;flex:none;}
.m-title{font-family:'Fraunces',serif;font-weight:600;font-size:11.2pt;color:var(--navy);line-height:1.2;}
.m-why{font-size:9.2pt;line-height:1.5;color:#41506a;margin-top:4pt;}

/* episode Q&A */
.qa{padding:9pt 0;border-bottom:1px solid var(--line);break-inside:avoid;}
.qa:last-child{border-bottom:0;}
.qa-q{font-family:'Fraunces',serif;font-weight:600;font-size:11.2pt;color:var(--navy);margin-bottom:4pt;}
.qb{font-family:'Inter';font-weight:700;font-size:7.2pt;color:#fff;background:var(--gold);padding:1.5px 7px;border-radius:4px;margin-right:8px;letter-spacing:.06em;}
.qa-a{font-size:9.4pt;line-height:1.55;color:#41506a;}

.prose p{font-size:10pt;line-height:1.6;color:#2b3850;margin-bottom:8pt;}

table.srcs{width:100%;border-collapse:collapse;break-inside:avoid;}
table.srcs th{font-family:'Inter';font-weight:700;font-size:6.9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);
 text-align:left;padding:0 9px 6pt;border-bottom:1.6px solid var(--gold);}
table.srcs th.r{text-align:right;}
table.srcs td{font-family:'Inter';font-weight:500;font-size:9.1pt;color:var(--navy);padding:6.4pt 9px;border-bottom:1px solid var(--line);vertical-align:middle;line-height:1.3;}
table.srcs tr:nth-child(even) td{background:#fafbfd;}
td.r{text-align:right;}
.tag{display:inline-block;font-family:'Inter';font-weight:600;font-size:6.9pt;letter-spacing:.06em;text-transform:uppercase;padding:2.5px 9px;border-radius:20px;white-space:nowrap;}
.tag-navy{background:var(--navy);color:#eef3fa;}
.tag-gold{background:var(--gold);color:#fff;}
.tag-slate{background:var(--slate);color:#fff;}

.pdf-foot{margin-top:20pt;padding-top:9pt;border-top:1px solid #d8c187;display:flex;justify-content:space-between;align-items:center;
 font-family:'Inter';font-size:7.6pt;color:#8893a2;}
.pdf-foot b{color:var(--gold);font-weight:700;}
.pdf-foot .r{letter-spacing:.12em;text-transform:uppercase;color:var(--gold);}
`

// ── shared builders ──────────────────────────────────────────────────────────
function showTagColors(names: string[]): (name: string) => TagColor {
  const palette: TagColor[] = ['navy', 'gold', 'slate']
  const map = new Map<string, TagColor>()
  let i = 0
  for (const n of names) if (n && !map.has(n)) map.set(n, palette[i++ % palette.length])
  return (n) => map.get(n) ?? 'slate'
}

function coverInner(o: { eyebrow?: string; kicker?: string; title: string; dateRange?: string; chips?: string[]; footerLeft?: string }): string {
  const chips = (o.chips ?? [])
    .filter(Boolean)
    .map((c) => `<span class="c-chip">${esc(c)}</span>`)
    .join('<span class="c-dot">&middot;</span>')
  return `<div class="cover">
    <div class="wm"></div>
    <div class="frame"></div>
    <div class="corner-tr" style="right:11mm;top:11mm;border-left:0;border-bottom:0;"></div>
    <div class="corner-bl" style="left:11mm;bottom:11mm;border-right:0;border-top:0;"></div>
    <div class="inner">
      <div class="c-top">
        <div class="c-brand"><img src="${LOGO}" alt="" /><span class="nm">Munshot</span></div>
        <span class="c-kick">${esc(o.kicker ?? '')}</span>
      </div>
      <div class="c-toprule"></div>
      <div class="c-hero">
        <div class="glow"><img src="${LOGO}" alt="" /></div>
        ${o.eyebrow ? `<div class="c-eyebrow">${esc(o.eyebrow)}</div>` : ''}
        <div class="c-title">${esc(o.title)}</div>
        ${o.dateRange ? `<div class="c-date">${esc(o.dateRange)}</div>` : ''}
        ${chips ? `<div class="c-meta">${chips}</div>` : ''}
      </div>
      <div class="c-botrule"></div>
      <div class="c-bot">
        <div class="c-bl">${o.footerLeft ?? ''}</div>
        <div class="c-br">${esc(o.dateRange ?? '')}</div>
      </div>
    </div>
  </div>`
}

function secHead(num: string, title: string): string {
  return `<div class="sec-head"><span class="sec-num">${esc(num)}</span><span class="sec-title">${esc(title)}</span><span class="sec-rule"></span></div>`
}

function section(num: string, title: string, body: string): string {
  if (!body) return ''
  return `<section class="sec">${secHead(num, title)}${body}</section>`
}

function ideaCard(idea: WeeklyIdea | { idea: string; proponent: string; thesis: string[]; kind?: string }): string {
  const kind = idea.kind ? `<span class="idea-kind">${esc(idea.kind)}</span>` : ''
  const who = idea.proponent && idea.proponent !== '—' ? `<div class="idea-who">Pitched by <b>${esc(idea.proponent)}</b></div>` : ''
  const thesis = idea.thesis.length ? `<ul class="thesis">${idea.thesis.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>` : ''
  return `<div class="idea"><div class="idea-title">${kind}${esc(idea.idea)}</div>${who}${thesis}</div>`
}

function showBlock(d: WeeklyShowDigest): string {
  const count = d.episodeCount ? `<span class="show-count">${d.episodeCount} episode${d.episodeCount === 1 ? '' : 's'}</span>` : ''
  const head = `<div class="show-head"><span class="show-name">${esc(d.show)}</span><span class="show-spacer"></span>${count}</div>`
  const ideas = d.ideas.length ? `<div class="subhead">Ideas Pitched</div>${d.ideas.map(ideaCard).join('')}` : ''
  const takeaways = d.takeaways.length
    ? `<div class="subhead">Key Takeaways</div><ul class="tlist">${d.takeaways
        .map((t) => `<li><span class="ti">${esc(t.title)}.</span> ${inline(t.detail)}</li>`)
        .join('')}</ul>`
    : ''
  const questions = d.questions.length
    ? `<div class="subhead">Questions</div><div class="qs"><div class="qgrid">${d.questions
        .map((q) => `<div class="q">${inline(q)}</div>`)
        .join('')}</div></div>`
    : ''
  return `<div class="show">${head}${ideas}${takeaways}${questions}</div>`
}

function pdfShell(title: string, inner: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>${esc(title)}</title>
<style>${PDF_CSS}</style>
</head><body>${inner}</body></html>`
}

// ── Weekly ───────────────────────────────────────────────────────────────────
export function weeklyToPdfHtml(weekly: WeeklySummary, episodeById: ById<Episode>, podcastById: ById<Podcast>): string {
  const cover = coverInner({
    eyebrow: 'AI Podcast Intelligence',
    kicker: 'Weekly Intelligence',
    title: 'Weekly Summary',
    dateRange: weekly.rangeLabel,
    chips: [`${weekly.episodeCount} episode${weekly.episodeCount === 1 ? '' : 's'}`, `${weekly.readMinutes} min read`],
    footerLeft: 'Generated by <b>Munshot</b> &middot; AI podcast intelligence',
  })

  const overview = weekly.overview.length
    ? `<div class="lead">${weekly.overview.map((p, i) => `<p${i === 0 ? ' class="first"' : ''}>${inline(p)}</p>`).join('')}</div>`
    : ''
  const shows = (weekly.shows ?? []).map(showBlock).join('')
  const themes = weekly.topThemes.length
    ? `<div class="kwrap">${weekly.topThemes.map((t) => `<span class="kw">${esc(t.label)}</span>`).join('')}</div>`
    : ''
  const mcol = (label: string, items: string[]) =>
    `<div class="mcol"><div class="mh">${esc(label)}</div>${
      items.length ? items.map((it) => `<span class="mchip">${esc(it)}</span>`).join('') : '<div class="mempty">&mdash;</div>'
    }</div>`
  const mentions =
    weekly.mentions.people.length || weekly.mentions.companies.length
      ? `<div class="mentions">${mcol('People', weekly.mentions.people)}${mcol('Companies', weekly.mentions.companies)}</div>`
      : ''
  const interesting = weekly.interesting.quote
    ? `<div class="interesting">${weekly.interesting.title ? `<div class="int-qt">${esc(weekly.interesting.title)}</div>` : ''}<div class="int-ql">${esc(
        weekly.interesting.quote,
      )}</div><div class="int-at"><span class="dot"></span><span class="who">${esc(weekly.interesting.speaker)}</span><span class="role">${esc(
        weekly.interesting.role,
      )}</span></div></div>`
    : ''

  const sources = weekly.sourceEpisodeIds.map(episodeById).filter((e): e is Episode => Boolean(e))
  const colorFor = showTagColors(sources.map((e) => podcastById(e.podcastId)?.title ?? ''))
  const sourcesBody = sources.length
    ? `<table class="srcs"><thead><tr><th>Episode</th><th class="r">Show</th></tr></thead><tbody>${sources
        .map((ep) => {
          const show = podcastById(ep.podcastId)?.title ?? ''
          return `<tr><td>${esc(ep.title)}</td><td class="r">${show ? `<span class="tag tag-${colorFor(show)}">${esc(show)}</span>` : ''}</td></tr>`
        })
        .join('')}</tbody></table>`
    : ''

  const inner = `${cover}
    ${section('01', 'This Week in Summary', overview)}
    ${section('02', 'By Show', shows)}
    ${section('03', 'Top Themes', themes)}
    ${section('04', 'Mentions', mentions)}
    ${section('05', 'What Was Actually Interesting', interesting)}
    ${section('06', 'Source Episodes', sourcesBody)}
    <div class="pdf-foot"><span>Generated by <b>Munshot</b> &middot; AI podcast intelligence</span><span class="r">${esc(weekly.rangeLabel)}</span></div>`

  return pdfShell(`Munshot Weekly — ${weekly.rangeLabel}`, inner)
}

// ── Episode ──────────────────────────────────────────────────────────────────
export function summaryToPdfHtml(episode: Episode, podcast?: Podcast): string {
  const s = episode.summary
  const cover = coverInner({
    eyebrow: podcast ? `${podcast.title} · ${podcast.author}` : 'Episode Intelligence',
    kicker: 'Episode Intelligence',
    title: episode.title,
    dateRange: longDate(episode.publishedAt),
    chips: [formatDuration(episode.durationSec), ...(s ? [`${s.highlights.length} highlights`, `${s.qa.length} questions`] : [])],
    footerLeft: 'Generated by <b>Munshot</b> &middot; AI podcast intelligence',
  })

  const synthesis = s?.synthesis ?? []
  const summaryBody = synthesis.length
    ? `<div class="lead">${synthesis.map((p, i) => `<p${i === 0 ? ' class="first"' : ''}>${inline(p)}</p>`).join('')}</div>`
    : ''
  const ideasBody = (s?.ideas ?? []).map(ideaCard).join('')
  const highlightsBody = s?.highlights.length
    ? s.highlights
        .map(
          (h) =>
            `<div class="moment"><div class="m-top"><span class="ts">${esc(h.timestamp)}</span>${
              h.key ? '<span class="m-star">&#9733;</span>' : ''
            }<span class="m-title">${esc(h.title)}</span></div><div class="m-why">${inline(h.detail)}</div></div>`,
        )
        .join('')
    : ''
  const qaBody = s?.qa.length
    ? s.qa.map((item) => `<div class="qa"><div class="qa-q"><span class="qb">Q</span>${esc(item.q)}</div><div class="qa-a">${inline(item.a)}</div></div>`).join('')
    : ''

  const inner = `${cover}
    ${section('01', 'AI Summary', summaryBody)}
    ${section('02', 'Ideas Pitched', ideasBody)}
    ${section('03', 'Highlights', highlightsBody)}
    ${section('04', 'Q&A', qaBody)}
    <div class="pdf-foot"><span>Generated by <b>Munshot</b> &middot; AI podcast intelligence</span><span class="r">${esc(longDate(episode.publishedAt))}</span></div>`

  return pdfShell(`${episode.title} — Munshot Summary`, inner)
}

// ── Print launcher (standalone) ──────────────────────────────────────────────
// Render the styled HTML in a hidden, same-origin iframe (so /fonts and the logo
// resolve), wait for fonts + images, then open the browser's print → Save as PDF.
//
// NOTE: this only works when the app is the TOP document. Inside the chat.muns.io
// dashboard iframe — sandboxed `allow-scripts allow-same-origin allow-popups
// allow-forms allow-downloads`, i.e. WITHOUT `allow-modals` — the HTML spec makes
// every script-initiated window.print() a silent no-op for the whole frame tree
// (a child iframe inherits its parent's sandbox; a popup can't escape it without
// allow-popups-to-escape-sandbox). So when embedded we never call this; we hand
// the user a real file instead (see downloadPrintablePdf below).
export function printDocument(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'

  let fired = false
  iframe.onload = () => {
    const win = iframe.contentWindow
    const doc = iframe.contentDocument
    // Ignore a spurious empty load and never fire twice.
    if (fired || !win || !doc || !doc.querySelector('.cover')) return
    fired = true
    win.addEventListener('afterprint', () => setTimeout(() => iframe.remove(), 400))
    const go = () => {
      win.focus()
      win.print()
      setTimeout(() => iframe.parentNode && iframe.remove(), 60_000) // fallback cleanup
    }
    const fontsReady = doc.fonts?.ready ?? Promise.resolve()
    const waitImg = (img: HTMLImageElement): Promise<void> =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = () => res()
            img.onerror = () => res()
          })
    const imgsReady = Promise.all(Array.from(doc.images).map(waitImg))
    let printed = false
    const once = () => {
      if (printed) return
      printed = true
      go()
    }
    Promise.all([fontsReady, imgsReady]).then(() => setTimeout(once, 120))
    setTimeout(once, 3000) // hard fallback if fonts/images never settle
  }

  // srcdoc keeps the base URL same-origin so /fonts and the logo resolve.
  iframe.srcdoc = html
  document.body.appendChild(iframe)
}

// ── Embedded-safe delivery (download → Save as PDF) ──────────────────────────
// When the app runs inside the dashboard iframe, window.print() is blocked (see
// printDocument's note), but file downloads are NOT — `allow-downloads` is set,
// which is exactly how the Word export reaches the user. So instead of printing
// we DOWNLOAD the same styled document as a fully self-contained, print-ready
// HTML file: fonts + logo inlined as data URIs (so it renders 1:1 even opened
// from disk, offline) and a tiny launcher that pops Save-as-PDF the moment it's
// opened — with an always-visible "Save as PDF" button as a guaranteed fallback.
// This path cannot be silently blocked, so the PDF always reaches the user.

function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true // cross-origin window.top access throws → we ARE embedded
  }
}

// The woff2 files PDF_CSS references, by the exact URL used in the @font-face src.
const FONT_FILES = [
  'Fraunces-400', 'Fraunces-500', 'Fraunces-600', 'Fraunces-900',
  'Inter-400', 'Inter-500', 'Inter-600', 'Inter-700', 'Inter-800',
  'IBMPlexMono-400', 'IBMPlexMono-500', 'IBMPlexMono-600',
].map((n) => `/fonts/${n}.woff2`)

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const chunks: string[] = []
  const SIZE = 0x8000 // chunk the spread so we never blow the argument limit
  for (let i = 0; i < bytes.length; i += SIZE) chunks.push(String.fromCharCode(...bytes.subarray(i, i + SIZE)))
  return btoa(chunks.join(''))
}

async function toDataUri(url: string, mime: string, f: typeof fetch): Promise<string | null> {
  try {
    const res = await f(url)
    if (!res.ok) return null
    return `data:${mime};base64,${bufToBase64(await res.arrayBuffer())}`
  } catch {
    return null // a missing asset just falls back to its CSS generic — never throw
  }
}

// Replace every same-origin /fonts/*.woff2 reference with an inlined data URI so
// the downloaded file carries its own fonts. Assets that fail to fetch are left
// as-is (graceful: the doc still opens; that family falls back to its generic).
export async function inlineFonts(html: string, f: typeof fetch = fetch): Promise<string> {
  const uris = await Promise.all(FONT_FILES.map(async (url) => [url, await toDataUri(url, 'font/woff2', f)] as const))
  let out = html
  for (const [url, uri] of uris) if (uri) out = out.split(url).join(uri)
  return out
}

// Floating "Save as PDF" button (hidden in the printout) + an auto-print on open.
// As a TOP-level document the file may freely call print(), so opening it lands
// the user straight on Save-as-PDF; the button is the manual guarantee.
const PRINT_LAUNCHER = `
<div class="pdf-actionbar" role="toolbar" aria-label="Save this document">
  <button type="button" class="pdf-savebtn" onclick="window.print()">Save as PDF</button>
</div>
<style>
@media screen{
 .pdf-actionbar{position:fixed;top:14px;right:14px;z-index:2147483647;}
 .pdf-savebtn{font-family:'Inter',system-ui,-apple-system,sans-serif;font-weight:700;font-size:13px;letter-spacing:.01em;
  color:#fff;background:#b8902f;border:0;border-radius:9px;padding:11px 18px;cursor:pointer;box-shadow:0 8px 22px rgba(184,144,47,.4);}
 .pdf-savebtn:hover{background:#a37e26;}
}
@media print{.pdf-actionbar{display:none!important;}}
</style>
<script>
(function(){
 var done=false;
 function go(){if(done)return;done=true;try{window.focus();window.print();}catch(e){}}
 var fonts=(document.fonts&&document.fonts.ready)?document.fonts.ready:Promise.resolve();
 var imgs=Promise.all([].map.call(document.images,function(i){return i.complete?0:new Promise(function(r){i.onload=i.onerror=r;});}));
 Promise.all([fonts,imgs]).then(function(){setTimeout(go,180);});
 setTimeout(go,2600); // hard fallback if fonts/images never settle
})();
</script>`

export function injectPrintLauncher(html: string): string {
  return html.includes('</body>') ? html.replace('</body>', `${PRINT_LAUNCHER}</body>`) : html + PRINT_LAUNCHER
}

// Inlining 12 woff2 files is a network hop the download must wait on; cap it so
// the <a>.click() still fires while the click's user-activation is fresh. If the
// budget blows, we ship the doc with absolute /fonts URLs — it still opens and
// prints (and the fonts resolve too whenever it's opened online).
const FONT_INLINE_BUDGET_MS = 2000

function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => done(fallback), ms)
    p.then(done, () => done(fallback))
  })
}

// Build the self-contained file and trigger a download (the proven allow-downloads
// path the Word export uses), then revoke the object URL. Font inlining and the
// logo import run in parallel to keep the gap before the click minimal.
async function downloadPrintablePdf(html: string, baseName: string): Promise<void> {
  const [withFonts, { MUNSHOT_LOGO }] = await Promise.all([
    withBudget(inlineFonts(html), FONT_INLINE_BUDGET_MS, html),
    import('./brandLogo'),
  ])
  const doc = injectPrintLauncher(withFonts.split(LOGO).join(MUNSHOT_LOGO))
  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${sanitizeFilename(baseName)}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Deliver a document as PDF, the right way for the context: a real Save-as-PDF
// dialog when standalone, a self-contained download when embedded (where print is
// blocked). If the download ever throws, fall back to a print attempt — so a PDF
// is always offered, never a dead button.
async function deliverPdf(html: string, baseName: string): Promise<void> {
  if (!isEmbedded()) {
    printDocument(html)
    return
  }
  try {
    await downloadPrintablePdf(html, baseName)
  } catch {
    printDocument(html)
  }
}

export function downloadWeeklyPdf(weekly: WeeklySummary, episodeById: ById<Episode>, podcastById: ById<Podcast>): Promise<void> {
  return deliverPdf(weeklyToPdfHtml(weekly, episodeById, podcastById), `Munshot Weekly — ${weekly.rangeLabel}`)
}

export function downloadSummaryPdf(episode: Episode, podcast?: Podcast): Promise<void> {
  return deliverPdf(summaryToPdfHtml(episode, podcast), `${episode.title} — Munshot Summary`)
}
