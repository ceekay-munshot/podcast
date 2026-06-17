import type { Episode, Podcast, WeeklyIdea, WeeklyShowDigest, WeeklySummary } from './types'
import { esc } from './exportDoc'

// ─────────────────────────────────────────────────────────────────────────────
// Email delivery — the real wiring behind the Weekly-brief subscription seam.
//
// POST https://devde.muns.io/email/send/raw
//   body: { email, subject, text }  OR  { email, subject, html }   (exactly one)
//   ok:   { data: { message }, message, success: true }
//
// The endpoint authenticates with the signed-in user's session (it "works with
// the user token using the dashboard"). This app runs inside the chat.muns.io
// ecosystem in the browser, so we send the request with `credentials: 'include'`
// to carry whatever muns.io auth cookie the browser already holds. If a future
// SDK build surfaces an explicit bearer token, pass it as `opts.token` and it
// rides along as `Authorization: Bearer …` — no other change needed here.
//
// Like the rest of the api seam, sending is BEST-EFFORT: any network/CORS/HTTP
// failure resolves to `{ ok: false, … }` rather than throwing, so a flaky mail
// hop never crashes a click handler. The single hard rule we enforce locally is
// the contract's "exactly one of text|html".
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_ENDPOINT = 'https://devde.muns.io/email/send/raw'

export interface EmailResult {
  ok: boolean
  /** The server's human message ("Email sent successfully!"), or a local error reason. */
  message: string
}

interface BaseEmail {
  email: string
  subject: string
}
/** Send EITHER text OR html — never both, never neither (the endpoint's contract). */
export type RawEmail = BaseEmail & ({ text: string; html?: never } | { html: string; text?: never })

/** The endpoint's JSON envelope: `{ data: { message }, message, success }`. */
interface EmailEndpointResponse {
  success?: boolean
  message?: string
  data?: { message?: string }
}

/** Send one email through the Munshot raw-email endpoint. Resolves `{ ok }`;
 *  never throws (network/CORS/HTTP errors become `ok: false`). */
export async function sendRawEmail(message: RawEmail, opts: { token?: string } = {}): Promise<EmailResult> {
  const email = message.email?.trim()
  const subject = message.subject?.trim()
  const hasText = typeof (message as { text?: unknown }).text === 'string' && (message as { text: string }).text.length > 0
  const hasHtml = typeof (message as { html?: unknown }).html === 'string' && (message as { html: string }).html.length > 0

  if (!email) return { ok: false, message: 'A recipient email is required.' }
  if (!subject) return { ok: false, message: 'An email subject is required.' }
  if (hasText === hasHtml) return { ok: false, message: 'Send exactly one of text or html.' }

  const body: Record<string, string> = { email, subject }
  if (hasText) body.text = (message as { text: string }).text
  else body.html = (message as { html: string }).html

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.token) headers.authorization = `Bearer ${opts.token}`

  try {
    const res = await fetch(EMAIL_ENDPOINT, {
      method: 'POST',
      credentials: 'include', // carry the muns.io session — the "user token using the dashboard"
      headers,
      body: JSON.stringify(body),
    })
    let payload: EmailEndpointResponse | null = null
    try {
      payload = (await res.json()) as EmailEndpointResponse
    } catch {
      /* non-JSON (e.g. an HTML error page) — fall back to status below */
    }
    if (res.ok && payload?.success) {
      return { ok: true, message: payload.data?.message || payload.message || 'Email sent.' }
    }
    return { ok: false, message: payload?.message || payload?.data?.message || `Send failed (${res.status}).` }
  } catch {
    // Network down, blocked by CORS, or offline — degrade quietly.
    return { ok: false, message: "Couldn't reach the email service." }
  }
}

// ── HTML email templates (email-client-safe) ────────────────────────────────
// Email clients (notably Gmail) strip <head>/<style> and most class selectors,
// so every rule here is an INLINE style and every layout is a table — the same
// house style as the Word/PDF exports (navy #14233c, gold #b8902f, Georgia
// display), rebuilt for the inbox. Web-safe fonts only (no @font-face).

const C = {
  navy: '#14233c',
  ink: '#1a2b4a',
  gold: '#b8902f',
  goldSoft: '#e7cf93',
  body: '#42506a',
  prose: '#2b3850',
  line: '#e6eaf1',
  panel: '#f6f8fb',
  cream: '#faf6ea',
  page: '#eef1f6',
  white: '#ffffff',
}
const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "Arial, Helvetica, 'Segoe UI', sans-serif"
const MONO = "'Courier New', Courier, monospace"

/** esc + promote **bold** to gold <strong> (mirrors the in-app/doc emphasis rule). */
function richInline(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${C.gold};font-weight:700;">$1</strong>`)
}

// The navy hero band that opens every Munshot email.
function header(eyebrow: string, title: string, dateRange?: string, chips: string[] = []): string {
  const chipHtml = chips
    .filter(Boolean)
    .map(
      (c) =>
        `<span style="display:inline-block;font-family:${MONO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#cdd7e6;border:1px solid #9c7b2e;padding:3px 10px;margin:0 4px;">${esc(
          c,
        )}</span>`,
    )
    .join('')
  return `<tr><td style="background:${C.navy};padding:30px 36px;border-top:3px solid ${C.gold};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${SERIF};font-weight:700;font-size:18px;letter-spacing:1px;color:#f3f6fb;">Munshot</td>
        <td align="right" style="font-family:${SANS};font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${C.goldSoft};">Weekly Intelligence</td>
      </tr></table>
      <div style="border-top:1px solid #9c7b2e;margin:16px 0;font-size:0;line-height:0;">&nbsp;</div>
      <div style="font-family:${SANS};font-weight:700;font-size:11px;letter-spacing:4px;text-transform:uppercase;color:#cea344;">${esc(
        eyebrow,
      )}</div>
      <div style="font-family:${SERIF};font-weight:700;font-size:34px;line-height:1.1;color:#f4eedf;margin-top:8px;">${esc(
        title,
      )}</div>
      ${dateRange ? `<div style="font-family:${SERIF};font-style:italic;font-size:17px;color:${C.goldSoft};margin-top:10px;">${esc(dateRange)}</div>` : ''}
      ${chipHtml ? `<div style="margin-top:16px;">${chipHtml}</div>` : ''}
    </td></tr>`
}

function footer(): string {
  return `<tr><td style="background:${C.navy};padding:18px 36px;border-top:1px solid #9c7b2e;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${SANS};font-size:11px;color:#9fb0c6;">Generated by <strong style="color:#e7eef7;">Munshot</strong> &middot; AI podcast intelligence</td>
        <td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${C.goldSoft};">muns.io</td>
      </tr></table>
      <p style="font-family:${SANS};font-size:11px;color:#7d8ba3;margin:10px 0 0;">You're receiving this because you subscribed to the Munshot Weekly Brief. Manage it from the dashboard's weekly-brief bell.</p>
    </td></tr>`
}

// A gold-uppercase section label.
function sectionLabel(text: string): string {
  return `<div style="font-family:${SANS};font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};border-left:3px solid ${C.gold};padding-left:10px;margin:26px 0 12px;">${esc(
    text,
  )}</div>`
}

// Wrap an email body in the centered, page-background shell.
function shell(title: string, rows: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${esc(
    title,
  )}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:${C.white};border:1px solid #dfe4ec;border-radius:4px;overflow:hidden;">
        ${rows}
      </table>
    </td></tr>
  </table>
</body></html>`
}

/** Subscription confirmation — a designed, branded welcome (no fabricated data). */
export function welcomeEmailHtml(opts: { name?: string } = {}): string {
  const greeting = opts.name ? `Hi ${esc(opts.name.split(/\s+/)[0])},` : 'Hello,'
  const inside = [
    ['By show', 'each show you track, distilled into its own mini-digest.'],
    ['Ideas pitched', 'the concrete stock, trade, and macro calls — with the thesis behind each.'],
    ['Key takeaways', 'the few conclusions actually worth remembering.'],
    ['What was interesting', 'the one moment from the week worth a second look.'],
  ]
    .map(
      ([t, d]) =>
        `<tr><td style="padding:0 0 10px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.body};"><span style="color:${C.gold};font-weight:700;">&#9670;</span> <strong style="color:${C.ink};">${esc(
          t,
        )}.</strong> ${esc(d)}</td></tr>`,
    )
    .join('')

  const bodyRow = `<tr><td style="padding:30px 36px;">
      <p style="font-family:${SANS};font-size:15px;color:${C.prose};margin:0 0 14px;">${greeting}</p>
      <p style="font-family:${SANS};font-size:15px;line-height:1.6;color:${C.prose};margin:0 0 18px;">You're subscribed to the <strong style="color:${C.ink};">Munshot Weekly Brief</strong>. Every Monday we'll send you one email with the whole week's summary across the shows you track — synthesised, organised, and citation-backed.</p>
      ${sectionLabel("What's inside each edition")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${inside}</table>
      <p style="font-family:${SANS};font-size:13px;line-height:1.6;color:${C.body};margin:22px 0 0;padding-top:16px;border-top:1px solid ${C.line};">No brief yet this week? You'll get the next edition the moment it's ready. You can read the live summary any time from the dashboard.</p>
    </td></tr>`

  return shell(
    "You're subscribed — Munshot Weekly Brief",
    header('AI Podcast Intelligence', "You're subscribed") + bodyRow + footer(),
  )
}

// ── Weekly edition → HTML email (real content) ───────────────────────────────

function ideaBlock(idea: WeeklyIdea): string {
  const kind = idea.kind
    ? `<span style="display:inline-block;font-family:${SANS};font-weight:700;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:${C.gold};background:${C.cream};border:1px solid #e2cf95;padding:1px 7px;margin-right:7px;">${esc(
        idea.kind,
      )}</span>`
    : ''
  const who =
    idea.proponent && idea.proponent !== '—'
      ? `<p style="font-family:${SANS};font-size:12px;color:#54606e;margin:0 0 7px;">Pitched by <strong style="color:${C.ink};">${esc(
          idea.proponent,
        )}</strong></p>`
      : ''
  const thesis = idea.thesis.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${idea.thesis
        .map(
          (t) =>
            `<tr><td style="font-family:${SANS};font-size:13px;line-height:1.5;color:${C.body};padding:0 0 3px;"><span style="color:${C.gold};">&#9670;</span> ${richInline(
              t,
            )}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};border-left:3px solid ${C.gold};margin:0 0 8px;"><tr><td style="padding:12px 14px;">
      <div style="font-family:${SERIF};font-weight:700;font-size:15px;color:${C.ink};margin:0 0 5px;">${kind}${esc(idea.idea)}</div>
      ${who}${thesis}
    </td></tr></table>`
}

function showBlock(d: WeeklyShowDigest): string {
  const count = `${d.episodeCount} episode${d.episodeCount === 1 ? '' : 's'}`
  const head = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #d4dbe6;margin:0 0 10px;"><tr>
      <td style="font-family:${SERIF};font-weight:700;font-size:17px;color:${C.ink};padding-bottom:6px;">${esc(d.show)}</td>
      <td align="right" style="font-family:${SANS};font-size:12px;color:#7d8ba3;padding-bottom:6px;">${esc(count)}</td>
    </tr></table>`
  const subhead = (t: string) =>
    `<div style="font-family:${SANS};font-weight:700;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.gold};margin:12px 0 7px;">${esc(t)}</div>`
  const ideas = d.ideas.length ? subhead('Ideas Pitched') + d.ideas.map(ideaBlock).join('') : ''
  const takeaways = d.takeaways.length
    ? subhead('Key Takeaways') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${d.takeaways
        .map(
          (t) =>
            `<tr><td style="font-family:${SANS};font-size:14px;line-height:1.55;color:${C.body};padding:0 0 6px;"><span style="color:${C.gold};">&#9642;</span> <strong style="color:${C.ink};">${esc(
              t.title,
            )}.</strong> ${richInline(t.detail)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  const questions = d.questions.length
    ? subhead('Questions') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${d.questions
        .map(
          (q) =>
            `<tr><td style="font-family:${SANS};font-size:13px;font-style:italic;line-height:1.5;color:#46566f;border-left:2px solid #cea344;padding:0 0 6px 10px;margin:0;">${richInline(
              q,
            )}</td></tr>`,
        )
        .join('')}</table>`
    : ''
  return `<div style="margin:0 0 22px;">${head}${ideas}${takeaways}${questions}</div>`
}

function chipsRow(items: string[]): string {
  if (!items.length) return ''
  return items
    .map(
      (i) =>
        `<span style="display:inline-block;font-family:${MONO};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.ink};background:${C.cream};border:1px solid #e2cf95;padding:4px 10px;margin:0 6px 6px 0;">${esc(
          i,
        )}</span>`,
    )
    .join('')
}

function mentionsCol(label: string, items: string[]): string {
  const chips = items.length
    ? items
        .map(
          (it) =>
            `<span style="display:inline-block;font-family:${SANS};font-weight:700;font-size:12px;color:${C.ink};background:#eef2f7;border:1px solid #d4dbe6;padding:3px 9px;margin:0 5px 5px 0;">${esc(
              it,
            )}</span>`,
        )
        .join('')
    : `<span style="font-family:${SANS};color:#828c99;">&mdash;</span>`
  return `<div style="font-family:${SANS};font-weight:700;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${C.ink};border-bottom:1px solid ${C.gold};padding-bottom:5px;margin:0 0 9px;">${esc(
    label,
  )}</div>${chips}`
}

type ById<T> = (id: string) => T | undefined

/** Render a real Weekly edition as a designed HTML email (mirrors the Word/PDF). */
export function weeklyBriefEmailHtml(
  weekly: WeeklySummary,
  episodeById: ById<Episode>,
  podcastById: ById<Podcast>,
): string {
  const overview = weekly.overview.length
    ? `${sectionLabel('This Week in Summary')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border-left:3px solid ${C.gold};"><tr><td style="padding:14px 18px;">${weekly.overview
        .map(
          (p, i) =>
            `<p style="font-family:${SANS};font-size:14px;line-height:1.62;color:${C.prose};margin:0 0 ${
              i === weekly.overview.length - 1 ? '0' : '9px'
            };">${richInline(p)}</p>`,
        )
        .join('')}</td></tr></table>`
    : ''

  const shows = (weekly.shows ?? []).length ? sectionLabel('By Show') + (weekly.shows ?? []).map(showBlock).join('') : ''

  const themes = weekly.topThemes.length ? sectionLabel('Top Themes') + chipsRow(weekly.topThemes.map((t) => t.label)) : ''

  const hasMentions = weekly.mentions.people.length > 0 || weekly.mentions.companies.length > 0
  const mentions = hasMentions
    ? sectionLabel('Mentions') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};"><tr>
        <td width="50%" valign="top" style="padding:12px 14px;border-right:1px solid ${C.line};">${mentionsCol('People', weekly.mentions.people)}</td>
        <td width="50%" valign="top" style="padding:12px 14px;">${mentionsCol('Companies', weekly.mentions.companies)}</td>
      </tr></table>`
    : ''

  const interesting = weekly.interesting.quote
    ? sectionLabel('What Was Actually Interesting') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.navy};border:1px solid #6b5a2e;"><tr><td style="padding:16px 22px 18px;">
        <div style="font-family:${SERIF};font-weight:700;font-size:34px;line-height:.5;color:${C.gold};">&#8220;</div>
        ${
          weekly.interesting.title
            ? `<div style="font-family:${SERIF};font-weight:700;font-size:16px;color:${C.goldSoft};margin:8px 0;">${esc(weekly.interesting.title)}</div>`
            : ''
        }
        <div style="font-family:${SERIF};font-style:italic;font-size:14px;line-height:1.5;color:#dde6f2;">${esc(weekly.interesting.quote)}</div>
        <div style="margin-top:12px;font-family:${SANS};font-weight:700;font-size:12px;color:${C.goldSoft};">${esc(weekly.interesting.speaker)} <span style="font-weight:400;color:#9fb1c8;">${esc(
          weekly.interesting.role,
        )}</span></div>
      </td></tr></table>`
    : ''

  const sources = weekly.sourceEpisodeIds.map(episodeById).filter((e): e is Episode => Boolean(e))
  const sourcesBody = sources.length
    ? sectionLabel('Source Episodes') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sources
        .map((ep, i) => {
          const show = podcastById(ep.podcastId)?.title ?? ''
          return `<tr><td style="font-family:${SANS};font-size:13px;color:${C.ink};padding:7px 10px;border-bottom:1px solid ${C.line};${
            i % 2 ? `background:#fafbfd;` : ''
          }">${esc(ep.title)}</td><td align="right" style="font-family:${SANS};font-size:12px;color:#7d8ba3;padding:7px 10px;border-bottom:1px solid ${C.line};${
            i % 2 ? `background:#fafbfd;` : ''
          }">${esc(show)}</td></tr>`
        })
        .join('')}</table>`
    : ''

  const bodyRow = `<tr><td style="padding:8px 36px 30px;">${overview}${shows}${themes}${mentions}${interesting}${sourcesBody}</td></tr>`

  return shell(
    `Munshot Weekly — ${weekly.rangeLabel}`,
    header('AI Podcast Intelligence', 'Weekly Summary', weekly.rangeLabel, [
      `${weekly.episodeCount} episode${weekly.episodeCount === 1 ? '' : 's'}`,
      `${weekly.readMinutes} min read`,
    ]) +
      bodyRow +
      footer(),
  )
}
