import type { Episode, EpisodeInsight, Idea, Podcast, QAItem, QuantPoint, WeeklyShowDigest, WeeklySummary } from './types'
import { esc } from './exportDoc'
import { weeklyReportTitle } from './reportName'
import { formatDuration, longDate } from './format'
import { groupQuantByEpisode } from './weeklyQuant'

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

/** A file attached to an email. `content` is base64 (no `data:` prefix). Delivery
 *  depends on the endpoint supporting an `attachments` field — the send paths gate
 *  this behind EMAIL_ATTACHMENTS, so a build without endpoint support simply omits it. */
export interface EmailAttachment {
  filename: string
  content: string
  contentType: string
}
interface BaseEmail {
  email: string
  subject: string
  /** Optional attachments — only sent through when non-empty (else the body is byte-
   *  for-byte the historical text/html contract). */
  attachments?: EmailAttachment[]
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

  const body: Record<string, unknown> = { email, subject }
  if (hasText) body.text = (message as { text: string }).text
  else body.html = (message as { html: string }).html
  // Only attach the key when there's something to send, so a plain brief stays
  // byte-for-byte the historical text/html contract (and the endpoint never sees an
  // empty `attachments: []` it might choke on).
  if (message.attachments?.length) body.attachments = message.attachments

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
      return { ok: true, message: str(payload.data?.message) || str(payload.message) || 'Email sent.' }
    }
    // The endpoint sometimes nests a non-string error (e.g. { message: { statusCode } }),
    // so coerce to a clean string — never let an object reach the UI as "[object Object]".
    return { ok: false, message: str(payload?.message) || str(payload?.data?.message) || `Send failed (${res.status}).` }
  } catch {
    // Network down, blocked by CORS, or offline — degrade quietly.
    return { ok: false, message: "Couldn't reach the email service." }
  }
}

/** Send an ordered run of emails (a weekly brief split into parts), stopping at the
 *  first failure so nobody gets Part 3 without Part 2. Never throws. */
export async function sendRawEmailParts(messages: RawEmail[], opts: { token?: string } = {}): Promise<EmailResult> {
  let res: EmailResult = { ok: false, message: 'Nothing to send.' }
  for (let i = 0; i < messages.length; i++) {
    res = await sendRawEmail(messages[i], opts)
    if (!res.ok) return i ? { ok: false, message: `Sent ${i} of ${messages.length} parts — ${res.message}` } : res
  }
  return res
}

// ── proxy request → message(s) (shared by the prod proxy + dev middleware) ───
// A request carries ONE message (`subject` + text|html) or, for a weekly brief split
// to stay under Gmail's clip, an ordered `parts` list. The parts travel as one
// request so the proxy's per-recipient cooldown still means "one brief", not "one part".
export const MAX_EMAIL_PARTS = 8

export type EmailContent = { subject: string } & ({ text: string; html?: never } | { html: string; text?: never })

/** The message(s) in a proxy request body, or null when anything is malformed: a
 *  missing/CRLF subject, not exactly one of text|html, or an empty/over-long parts list. */
export function readEmailContent(body: { subject?: unknown; text?: unknown; html?: unknown; parts?: unknown }): EmailContent[] | null {
  const one = (m: unknown): EmailContent | null => {
    if (!m || typeof m !== 'object') return null
    const { subject, text, html } = m as Record<string, unknown>
    const t = typeof text === 'string' && text ? text : undefined
    const h = typeof html === 'string' && html ? html : undefined
    if (typeof subject !== 'string' || !subject || /[\r\n]/.test(subject) || !!t === !!h) return null
    return h ? { subject, html: h } : { subject, text: t as string }
  }
  if (body.parts === undefined) {
    const m = one(body)
    return m ? [m] : null
  }
  if (!Array.isArray(body.parts) || !body.parts.length || body.parts.length > MAX_EMAIL_PARTS) return null
  const parts = body.parts.map(one)
  return parts.every((p): p is EmailContent => p !== null) ? parts : null
}

/** Only a non-empty string survives — guards the UI from a nested error object. */
function str(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v : ''
}

// ── base64 (runtime-agnostic) ────────────────────────────────────────────────
// Pure-JS so it behaves identically in the browser, a Cloudflare Worker, and Node
// without depending on btoa/Buffer being typed in every tsconfig lib. Used to encode
// the weekly PDF bytes into an email attachment.
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function bytesToBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  let out = ''
  let i = 0
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + B64_ALPHABET[n & 63]
  }
  const rem = b.length - i
  if (rem === 1) {
    const n = b[i] << 16
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + '=='
  } else if (rem === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8)
    out += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + B64_ALPHABET[(n >> 6) & 63] + '='
  }
  return out
}

// ── attachment hardening (shared by the prod proxy + dev middleware) ─────────
export const MAX_ATTACHMENTS = 5
export const MAX_ATTACH_TOTAL_B64 = 8_000_000 // ~6MB of raw bytes across all attachments

/** Keep only well-formed, base64, header-safe attachments within the size budget.
 *  Malformed entries are dropped (never fatal), so a bad attachment can't block a send. */
export function cleanAttachments(raw: unknown): EmailAttachment[] {
  if (!Array.isArray(raw)) return []
  const out: EmailAttachment[] = []
  let total = 0
  for (const a of raw) {
    if (out.length >= MAX_ATTACHMENTS) break
    if (!a || typeof a !== 'object') continue
    const { filename, content, contentType } = a as Record<string, unknown>
    if (typeof filename !== 'string' || typeof content !== 'string' || typeof contentType !== 'string') continue
    if (!filename || !content || /[\r\n]/.test(filename) || /[\r\n]/.test(contentType)) continue
    const compact = content.replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) continue // must be clean base64
    total += compact.length
    if (total > MAX_ATTACH_TOTAL_B64) break
    out.push({ filename, content: compact, contentType })
  }
  return out
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

// Every Munshot email drives the reader back to the live dashboard.
const MUNS_DASHBOARD = 'https://chat.muns.io/dashboards'

/** esc + promote **bold** to gold <strong> (mirrors the in-app/doc emphasis rule). */
function richInline(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, `<strong style="color:${C.gold};font-weight:700;">$1</strong>`)
}

/** richInline + turn each inline [n] citation marker into a gold link back to the
 *  dashboard, so a reader can click any claim to open the full intelligence. */
function richCited(s: string, url: string = MUNS_DASHBOARD): string {
  return richInline(s).replace(/\[(\d+)\]/g, `<a href="${esc(url)}" style="color:${C.gold};font-weight:700;text-decoration:none;">[$1]</a>`)
}

/** A pill CTA button — filled navy (primary) or outlined (secondary). */
function ctaButton(href: string, label: string, opts: { primary?: boolean } = {}): string {
  const bg = opts.primary ? C.navy : C.white
  const fg = opts.primary ? '#ffffff' : C.navy
  const border = opts.primary ? '#6b5a2e' : '#d8c187'
  return `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:${fg};font-family:${SANS};font-weight:700;font-size:14px;text-decoration:none;padding:13px 26px;border-radius:6px;border:1px solid ${border};">${label}</a>`
}

// The navy hero band that opens every Munshot email. `kicker` is the gold
// top-right label (defaults to the weekly wording so existing emails are
// byte-identical; the episode email overrides it).
function header(eyebrow: string, title: string, dateRange?: string, chips: string[] = [], kicker = 'Weekly Intelligence'): string {
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
        <td align="right" style="font-family:${SANS};font-weight:700;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${C.goldSoft};">${esc(kicker)}</td>
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

// `note` is the small reassurance line (defaults to the weekly-brief wording so
// existing emails are unchanged; the episode email passes its own).
function footer(
  note = `You're receiving this because you subscribed to the Munshot Weekly Brief. Manage it from your <a href="${MUNS_DASHBOARD}" style="color:${C.goldSoft};">Munshot dashboard</a>'s weekly-brief bell.`,
): string {
  return `<tr><td style="background:${C.navy};padding:18px 36px;border-top:1px solid #9c7b2e;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${SANS};font-size:11px;color:#9fb0c6;">Generated by <strong style="color:#e7eef7;">Munshot</strong> &middot; AI podcast intelligence</td>
        <td align="right" style="font-family:${MONO};font-size:10px;letter-spacing:1.5px;text-transform:uppercase;"><a href="${MUNS_DASHBOARD}" style="color:${C.goldSoft};text-decoration:none;">chat.muns.io</a></td>
      </tr></table>
      <p style="font-family:${SANS};font-size:11px;color:#7d8ba3;margin:10px 0 0;">${note}</p>
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
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 4px;"><tr><td align="center">
        ${ctaButton(MUNS_DASHBOARD, '&#128202;&nbsp; Open your Munshot dashboard', { primary: true })}
        <div style="font-family:${SANS};font-size:11px;color:#8794a8;margin-top:9px;">Don't wait for Monday — the live summary is ready now.</div>
      </td></tr></table>
      <p style="font-family:${SANS};font-size:13px;line-height:1.6;color:${C.body};margin:20px 0 0;padding-top:16px;border-top:1px solid ${C.line};">No brief yet this week? You'll get the next edition the moment it's ready — and you can read the live summary any time on your <a href="${MUNS_DASHBOARD}" style="color:${C.gold};font-weight:700;text-decoration:none;">Munshot dashboard</a>.</p>
    </td></tr>`

  return shell(
    "You're subscribed — Munshot Weekly Brief",
    header('AI Podcast Intelligence', "You're subscribed") + bodyRow + footer(),
  )
}

// ── Weekly edition → HTML email (real content) ───────────────────────────────

function ideaBlock(idea: Idea): string {
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

type ById<T> = (id: string) => T | undefined

// ── Splitting a long edition across several emails ───────────────────────────
// Gmail clips any message whose HTML passes ~102KB: everything after the cut hides
// behind "[Message clipped] View entire message", so a full week (20+ episodes) lost
// its later readout cards and its sources. A long edition therefore goes out as
// Part 1, Part 2, … — each a complete email that keeps the header, the dashboard
// CTA and the Download PDF button (the PDF is always the WHOLE edition). A section
// that spills over is re-opened in the next part as "<label> (continued)".

/** Per-part HTML ceiling, in UTF-8 bytes. Well under Gmail's ~102KB clip so the
 *  margin survives whatever transfer encoding the send endpoint applies (base64
 *  alone adds a third). */
export const EMAIL_PART_MAX_BYTES = 70_000

/** One email of a (possibly split) weekly edition. */
export interface EmailPart {
  subject: string
  html: string
}

/** One atomic piece of the weekly body — never split across emails. Consecutive
 *  blocks sharing a `wrap` render inside ONE wrapper (a table's rows), and the
 *  wrapper is re-opened when a part break lands mid-table. */
interface Block {
  html: string
  wrap?: (inner: string) => string
}
/** A labelled run of blocks, as placed in one part. `continued` marks a section that
 *  began in an earlier part. */
interface Section {
  label: string
  blocks: Block[]
  continued?: boolean
}

function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4 // surrogate pair → one 4-byte code point
      i++
    } else n += 3
  }
  return n
}

function sectionHead(label: string, continued?: boolean): string {
  return sectionLabel(continued ? `${label} (continued)` : label)
}

function renderBlocks(blocks: Block[]): string {
  let out = ''
  for (let i = 0; i < blocks.length; ) {
    const wrap = blocks[i].wrap
    let inner = ''
    do inner += blocks[i++].html
    while (wrap && i < blocks.length && blocks[i].wrap === wrap)
    out += wrap ? wrap(inner) : inner
  }
  return out
}

/** Greedily pack the sections, in order, into parts of at most `room` bytes of body. */
function packSections(sections: Section[], room: number): Section[][] {
  const parts: Section[][] = [[]]
  let used = 0
  for (const s of sections) {
    let slice: Section | undefined
    let started = false
    for (const b of s.blocks) {
      for (;;) {
        const last = slice?.blocks[slice.blocks.length - 1]
        const cost =
          (slice ? 0 : utf8Bytes(sectionHead(s.label, started))) +
          (b.wrap && last?.wrap !== b.wrap ? utf8Bytes(b.wrap('')) : 0) +
          utf8Bytes(b.html)
        // An empty part always takes the block, so one oversized block can't loop forever.
        if (used + cost <= room || used === 0) {
          if (!slice) {
            slice = { label: s.label, blocks: [], continued: started }
            parts[parts.length - 1].push(slice)
          }
          slice.blocks.push(b)
          used += cost
          started = true
          break
        }
        parts.push([])
        used = 0
        slice = undefined
      }
    }
  }
  return parts
}

/** "Munshot AI Podcasts — <week> (Part 2 of 3)" — the subject of one part. */
export function weeklyPartSubject(rangeLabel: string, part: number, total: number): string {
  return `${weeklyReportTitle(rangeLabel)} (Part ${part} of ${total})`
}

/** The weekly body as ordered sections of atomic blocks (empty sections omitted). */
function weeklySections(weekly: WeeklySummary, episodeById: ById<Episode>, podcastById: ById<Podcast>): Section[] {
  const sections: Section[] = []
  const add = (label: string, blocks: Block[]) => {
    if (blocks.length) sections.push({ label, blocks })
  }

  if (weekly.overview.length)
    add('Overview', [
      {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border-left:3px solid ${C.gold};"><tr><td style="padding:14px 18px;">${weekly.overview
          .map(
            (p, i) =>
              `<p style="font-family:${SANS};font-size:14px;line-height:1.62;color:${C.prose};margin:0 0 ${
                i === weekly.overview.length - 1 ? '0' : '9px'
              };">${richCited(p)}</p>`,
          )
          .join('')}</td></tr></table>`,
      },
    ])

  // Key Points — the synthesised, claim-first cross-episode body (primary). Falls
  // back to the by-show digest when no AI synthesis ran.
  const keyThemes = weekly.keyThemes ?? []
  add(
    'Key Points',
    keyThemes.map((t) => ({
      html:
        `<div style="font-family:${SANS};font-weight:700;font-size:14px;color:${C.ink};margin:14px 0 6px;">${esc(t.heading)}</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${t.points
          .map(
            (p) =>
              `<tr><td style="padding:0 0 8px;font-family:${SANS};font-size:13.5px;line-height:1.55;color:${C.body};"><span style="color:${C.gold};font-weight:700;">&#9670;</span> ${richCited(p)}</td></tr>`,
          )
          .join('')}</table>`,
    })),
  )

  if (!keyThemes.length) add('By Show', (weekly.shows ?? []).map((d) => ({ html: showBlock(d) })))

  // Grouped by episode so the numbers read per-source, not as one mixed list.
  const quantGroups = (weekly.quantTable ?? []).length ? groupQuantByEpisode(weekly.quantTable ?? [], weekly.citations ?? []) : []
  add(
    'Quantitative Summary',
    quantGroups.map((g) => {
      const heading = g.label ? `<div style="font-family:${SANS};font-weight:700;font-size:13px;color:${C.ink};margin:16px 0 6px;">${esc(g.label)}</div>` : ''
      const rows = g.rows
        .map(
          (q, i) =>
            `<tr${i % 2 ? ` style="background:#fafbfd;"` : ''}>
              <td style="font-family:${SANS};font-size:13px;color:${C.ink};padding:7px 12px;border-bottom:1px solid ${C.line};">${esc(q.metric)}</td>
              <td align="right" style="font-family:${SANS};font-size:13px;font-weight:700;color:${C.ink};white-space:nowrap;padding:7px 12px;border-bottom:1px solid ${C.line};">${esc(q.value)}</td>
              <td style="font-family:${SANS};font-size:12px;color:#7d8ba3;padding:7px 12px;border-bottom:1px solid ${C.line};">${esc(q.context)}</td>
            </tr>`,
        )
        .join('')
      return { html: `${heading}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};">${rows}</table>` }
    }),
  )

  // Investment Readout — per-episode evidence/interpretation. Email can't scroll a
  // wide table, so: a compact scannable table (episode · theme · names · confidence)
  // then full cards carrying the evidence / interpretation / questions / action.
  const readouts = weekly.episodeReadouts ?? []
  const stripN = (s: string) => s.replace(/\s*\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim()
  const confPill = (level: string) => {
    const [bg, fg] = level === 'High' ? ['#e7f3ec', '#2a7a48'] : level === 'Low' ? ['#f1f3f7', '#8794a8'] : ['#eef1f6', C.navy]
    return `<span style="display:inline-block;background:${bg};color:${fg};font-family:${SANS};font-weight:700;font-size:10.5px;padding:2px 8px;border-radius:5px;white-space:nowrap;">${esc(level)}</span>`
  }
  const th = `font-family:${SANS};font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:#7d8ba3;padding:7px 10px;border-bottom:1px solid ${C.line};`
  const cardLabel = (t: string) => `<div style="font-family:${SANS};font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${C.gold};margin:11px 0 3px;">${t}</div>`
  const cardProse = (s: string) => `<div style="font-family:${SANS};font-size:13px;line-height:1.55;color:${C.prose};">${richInline(stripN(s))}</div>`
  const readoutTable = (rows: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};margin-bottom:4px;"><tr style="background:${C.panel};"><th align="left" style="${th}">Episode</th><th align="left" style="${th}">Investable Theme</th><th align="left" style="${th}">Names / Sectors</th><th align="left" style="${th}">Confidence</th></tr>${rows}</table>`
  if (readouts.length)
    add('Investment Readout', [
      {
        html: `<p style="font-family:${SANS};font-size:13px;line-height:1.55;color:${C.body};margin:0 0 12px;">One readout per episode — what the podcast <em>actually said</em>, kept separate from the investment interpretation, with what to verify next.</p>`,
      },
      ...readouts.map((r, i) => ({
        html: `<tr${i % 2 ? ` style="background:#fafbfd;"` : ''}><td style="font-family:${SANS};font-size:12.5px;font-weight:600;color:${C.ink};padding:7px 10px;border-bottom:1px solid ${C.line};">${esc(r.episode)}</td><td style="font-family:${SANS};font-size:12.5px;color:${C.ink};padding:7px 10px;border-bottom:1px solid ${C.line};">${richInline(stripN(r.theme))}</td><td style="font-family:${SANS};font-size:11.5px;color:#7d8ba3;padding:7px 10px;border-bottom:1px solid ${C.line};">${esc(r.namesSectors)}</td><td style="padding:7px 10px;border-bottom:1px solid ${C.line};">${confPill(r.confidence)}</td></tr>`,
        wrap: readoutTable,
      })),
      ...readouts.map((r) => ({
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};margin-top:10px;"><tr><td style="padding:13px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-family:${SANS};font-weight:700;font-size:15px;color:${C.ink};">${esc(r.episode)}<div style="font-family:${SANS};font-weight:600;font-size:13px;color:${C.gold};margin-top:2px;">${richInline(stripN(r.theme))}</div></td><td align="right" valign="top" style="white-space:nowrap;">${confPill(r.confidence)}</td></tr></table>
        ${r.namesSectors && r.namesSectors !== '—' ? `<div style="font-family:${SANS};font-size:11.5px;color:#8794a8;margin-top:5px;">${esc(r.namesSectors)}</div>` : ''}
        ${cardLabel('Podcast evidence')}${cardProse(r.evidence)}
        ${cardLabel('Investment interpretation')}${cardProse(r.interpretation)}
        ${r.questionsToVerify.length ? cardLabel('Questions to verify') + `<ul style="margin:0;padding-left:18px;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.prose};">${r.questionsToVerify.map((q) => `<li style="margin-bottom:2px;">${richInline(stripN(q))}</li>`).join('')}</ul>` : ''}
        ${r.action ? cardLabel('Action') + cardProse(r.action) : ''}
      </td></tr></table>`,
      })),
    ])

  if (weekly.interesting.quote)
    add('What Was Actually Interesting', [
      {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.navy};border:1px solid #6b5a2e;"><tr><td style="padding:16px 22px 18px;">
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
      </td></tr></table>`,
      },
    ])

  const sources = weekly.sourceEpisodeIds.map(episodeById).filter((e): e is Episode => Boolean(e))
  const sourcesTable = (rows: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`
  if (sources.length)
    add('Sources', [
      ...sources.map((ep, i) => {
        const show = podcastById(ep.podcastId)?.title ?? ''
        const zebra = i % 2 ? `background:#fafbfd;` : ''
        // Every source links back to the dashboard — clicking a source is a way back in.
        return {
          html: `<tr><td style="font-family:${SANS};font-size:13px;padding:7px 10px;border-bottom:1px solid ${C.line};${zebra}"><a href="${MUNS_DASHBOARD}" style="color:${C.ink};text-decoration:none;font-weight:600;">${esc(ep.title)}</a></td><td align="right" style="font-family:${SANS};font-size:12px;color:#7d8ba3;padding:7px 10px;border-bottom:1px solid ${C.line};${zebra}">${esc(show)}</td></tr>`,
          wrap: sourcesTable,
        }
      }),
      {
        html: `<tr><td colspan="2" style="padding:12px 10px 0;font-family:${SANS};font-size:12px;">&#8594; <a href="${MUNS_DASHBOARD}" style="color:${C.gold};font-weight:700;text-decoration:none;">Open all of these on your Munshot dashboard</a></td></tr>`,
        wrap: sourcesTable,
      },
    ])

  return sections
}

interface PartInfo {
  index: number
  total: number
  /** Subject of the next part — absent on the last one. */
  next?: string
}

/** One complete weekly email: header, CTA, (part notice), the given sections, footer. */
function weeklyEmailDoc(weekly: WeeklySummary, title: string, sections: Section[], pdfUrl?: string, part?: PartInfo): string {
  // Lead with the call to action: open the live dashboard (the whole point — pull
  // the reader back into chat.muns.io), with the PDF download as the secondary.
  const ctaRow = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td align="center">
      ${ctaButton(MUNS_DASHBOARD, '&#128202;&nbsp; Open the live dashboard', { primary: true })}
      ${pdfUrl ? `<span style="display:inline-block;width:10px;">&nbsp;</span>${ctaButton(pdfUrl, '&#11015;&nbsp; Download PDF')}` : ''}
      <div style="font-family:${SANS};font-size:11px;color:#8794a8;margin-top:9px;">Explore the full intelligence — every show, idea, and source — on <a href="${MUNS_DASHBOARD}" style="color:${C.gold};font-weight:700;text-decoration:none;">Munshot</a></div>
    </td></tr></table>`

  const notice = part
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:${C.panel};border:1px solid ${C.line};border-left:3px solid ${C.gold};"><tr><td style="padding:11px 14px;font-family:${SANS};font-size:12.5px;line-height:1.55;color:${C.body};"><strong style="color:${C.ink};">Part ${part.index} of ${part.total}.</strong> This week's brief is long, so it arrives in ${part.total} emails${
        pdfUrl ? ' — the Download PDF above is always the complete edition' : ''
      }.</td></tr></table>`
    : ''

  const nextUp = part?.next
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;background:${C.navy};border:1px solid #6b5a2e;"><tr><td align="center" style="padding:16px 20px;">
        <div style="font-family:${SERIF};font-weight:700;font-size:16px;color:${C.goldSoft};">Continued in Part ${part.index + 1} of ${part.total} &#8594;</div>
        <div style="font-family:${SANS};font-size:12px;color:#cdd7e6;margin-top:6px;">Look for &ldquo;${esc(part.next)}&rdquo; in your inbox.</div>
      </td></tr></table>`
    : ''

  const body = sections.map((s) => sectionHead(s.label, s.continued) + renderBlocks(s.blocks)).join('')
  const bodyRow = `<tr><td style="padding:8px 36px 30px;">${ctaRow}${notice}${body}${nextUp}</td></tr>`

  const chips = [`${weekly.episodeCount} episode${weekly.episodeCount === 1 ? '' : 's'}`, `${weekly.readMinutes} min read`]
  if (part) chips.push(`Part ${part.index} of ${part.total}`)
  return shell(title, header('AI Podcast Intelligence', 'Weekly Summary', weekly.rangeLabel, chips) + bodyRow + footer())
}

/** Render a real Weekly edition as ONE designed HTML email (mirrors the Word/PDF),
 *  however long. Sends go through `weeklyBriefEmailParts`, which splits it. */
export function weeklyBriefEmailHtml(
  weekly: WeeklySummary,
  episodeById: ById<Episode>,
  podcastById: ById<Podcast>,
  opts: { pdfUrl?: string } = {},
): string {
  return weeklyEmailDoc(weekly, weeklyReportTitle(weekly.rangeLabel), weeklySections(weekly, episodeById, podcastById), opts.pdfUrl)
}

/** The weekly edition as the emails to send, in order. One email (the plain title as
 *  subject) when it fits under `maxBytes`; otherwise "(Part n of N)" emails, each
 *  standalone and each linking the full PDF. */
export function weeklyBriefEmailParts(
  weekly: WeeklySummary,
  episodeById: ById<Episode>,
  podcastById: ById<Podcast>,
  opts: { pdfUrl?: string; maxBytes?: number } = {},
): EmailPart[] {
  const title = weeklyReportTitle(weekly.rangeLabel)
  const sections = weeklySections(weekly, episodeById, podcastById)
  const whole = weeklyEmailDoc(weekly, title, sections, opts.pdfUrl)
  const max = opts.maxBytes ?? EMAIL_PART_MAX_BYTES
  if (utf8Bytes(whole) <= max) return [{ subject: title, html: whole }]

  // The chrome every part repeats (header, CTA, notices, footer), measured at a
  // worst-case part number so the packed body always fits beside it.
  const worst = weeklyPartSubject(weekly.rangeLabel, 99, 99)
  const chrome = utf8Bytes(weeklyEmailDoc(weekly, worst, [], opts.pdfUrl, { index: 98, total: 99, next: worst }))
  const packed = packSections(sections, max - chrome)
  const total = packed.length
  return packed.map((secs, i) => {
    const subject = weeklyPartSubject(weekly.rangeLabel, i + 1, total)
    const next = i + 1 < total ? weeklyPartSubject(weekly.rangeLabel, i + 2, total) : undefined
    return { subject, html: weeklyEmailDoc(weekly, subject, secs, opts.pdfUrl, { index: i + 1, total, next }) }
  })
}

// ── Single episode → HTML email (real content) ───────────────────────────────
// The on-demand "Email this edition" from an episode page. Mirrors the Word/PDF
// export's section order (AI Summary · Investable Insight · Key Numbers · Ideas
// Pitched · Highlights · Q&A) in the same inbox-safe house style as the weekly
// brief — every rule inline, every layout a table.

/** A named winners / at-risk party list (icon-free, email-safe). */
function partyList(items: EpisodeInsight['beneficiaries'], pos: boolean): string {
  if (!items.length) return ''
  const dot = pos ? '#16a34a' : '#dc2626'
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items
    .map(
      (p) =>
        `<tr><td style="font-family:${SANS};font-size:13px;line-height:1.55;color:${C.body};padding:0 0 5px;"><span style="color:${dot};font-weight:700;">&#9642;</span> <strong style="color:${C.ink};">${esc(
          p.name,
        )}</strong> — ${richInline(p.why)}</td></tr>`,
    )
    .join('')}</table>`
}

function insightBlock(ins: EpisodeInsight): string {
  const label = (t: string) =>
    `<div style="font-family:${SANS};font-weight:700;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${C.gold};margin:13px 0 3px;">${esc(t)}</div>`
  const prose = (s: string) => `<div style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.prose};">${richInline(s)}</div>`
  let out = ''
  if (ins.whatChanged) out += label('What changed') + prose(ins.whatChanged)
  if (ins.whyItMatters) out += label('Why it matters') + prose(ins.whyItMatters)
  if (ins.beneficiaries.length) out += label('Who benefits') + partyList(ins.beneficiaries, true)
  if (ins.atRisk.length) out += label("Who's at risk") + partyList(ins.atRisk, false)
  if (ins.diligenceQuestions.length)
    out +=
      label('Diligence questions') +
      `<ul style="margin:0;padding-left:18px;font-family:${SANS};font-size:13px;line-height:1.55;color:${C.prose};">${ins.diligenceQuestions
        .map((q) => `<li style="margin-bottom:2px;">${richInline(q)}</li>`)
        .join('')}</ul>`
  return out
}

function quantTableHtml(quant: QuantPoint[]): string {
  const rows = quant
    .map(
      (q, i) =>
        `<tr${i % 2 ? ` style="background:#fafbfd;"` : ''}>
          <td style="font-family:${SANS};font-size:13px;color:${C.ink};padding:7px 12px;border-bottom:1px solid ${C.line};">${esc(q.metric)}</td>
          <td align="right" style="font-family:${SANS};font-size:13px;font-weight:700;color:${C.ink};white-space:nowrap;padding:7px 12px;border-bottom:1px solid ${C.line};">${esc(q.value)}</td>
          <td style="font-family:${SANS};font-size:12px;color:#7d8ba3;padding:7px 12px;border-bottom:1px solid ${C.line};">${esc(q.context)}</td>
        </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};">${rows}</table>`
}

function qaBlockHtml(qa: QAItem[]): string {
  return qa
    .map(
      (item) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;"><tr><td style="padding:0;">
          <div style="font-family:${SERIF};font-weight:700;font-size:15px;color:${C.ink};margin:0 0 4px;">${esc(item.q)}</div>
          <div style="font-family:${SANS};font-size:14px;line-height:1.6;color:${C.prose};">${richInline(item.a)}</div>
        </td></tr></table>`,
    )
    .join('')
}

/** Render a single episode's summary as a designed HTML email (mirrors the
 *  Word/PDF export). Returns '' when the episode has no summary to send. */
export function episodeBriefEmailHtml(episode: Episode, podcast?: Podcast): string {
  const s = episode.summary
  if (!s) return ''

  const ctaRow = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr><td align="center">
      ${ctaButton(MUNS_DASHBOARD, '&#128202;&nbsp; Open the live dashboard', { primary: true })}
      <div style="font-family:${SANS};font-size:11px;color:#8794a8;margin-top:9px;">Read the full episode — highlights, transcript, and sources — on <a href="${MUNS_DASHBOARD}" style="color:${C.gold};font-weight:700;text-decoration:none;">Munshot</a></div>
    </td></tr></table>`

  // AI Summary — the readable one-page synthesis (lead in the cream call-out).
  const summary = s.synthesis.length
    ? `${sectionLabel('AI Summary')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border-left:3px solid ${C.gold};"><tr><td style="padding:14px 18px;">${s.synthesis
        .map(
          (p, i) =>
            `<p style="font-family:${SANS};font-size:14px;line-height:1.62;color:${C.prose};margin:0 0 ${
              i === s.synthesis.length - 1 ? '0' : '9px'
            };">${richInline(p)}</p>`,
        )
        .join('')}</td></tr></table>`
    : ''

  const insight = s.insight ? sectionLabel('Investable Insight') + insightBlock(s.insight) : ''

  const quant = s.quantData && s.quantData.length ? sectionLabel('Key Numbers') + quantTableHtml(s.quantData) : ''

  const ideas = s.ideas && s.ideas.length ? sectionLabel('Ideas Pitched') + s.ideas.map(ideaBlock).join('') : ''

  // Highlights — timeline beats, the AI's key takeaways starred.
  const highlights = s.highlights.length
    ? sectionLabel('Highlights') +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${s.highlights
        .map(
          (h) =>
            `<tr><td style="font-family:${SANS};font-size:14px;line-height:1.55;color:${C.body};padding:0 0 8px;">${
              h.timestamp && h.timestamp !== '—'
                ? `<span style="font-family:${MONO};font-size:11px;font-weight:700;color:${C.gold};">${esc(h.timestamp)}</span> `
                : ''
            }${h.key ? `<span style="color:${C.gold};">&#9733;</span> ` : ''}<strong style="color:${C.ink};">${esc(
              h.title,
            )}.</strong> ${richInline(h.detail)}</td></tr>`,
        )
        .join('')}</table>`
    : ''

  const qa = s.qa.length ? sectionLabel('Q&A') + qaBlockHtml(s.qa) : ''

  const bodyRow = `<tr><td style="padding:8px 36px 30px;">${ctaRow}${summary}${insight}${quant}${ideas}${highlights}${qa}</td></tr>`

  const chips = [
    formatDuration(episode.durationSec),
    `${s.highlights.length} highlight${s.highlights.length === 1 ? '' : 's'}`,
    `${s.qa.length} question${s.qa.length === 1 ? '' : 's'}`,
  ]

  return shell(
    `${episode.title} — Munshot Summary`,
    header(podcast ? `${podcast.title} · ${podcast.author}` : 'Episode Intelligence', episode.title, longDate(episode.publishedAt), chips, 'Episode Intelligence') +
      bodyRow +
      footer(
        `You're receiving this because you emailed yourself this episode summary from your <a href="${MUNS_DASHBOARD}" style="color:${C.goldSoft};">Munshot dashboard</a>.`,
      ),
  )
}
