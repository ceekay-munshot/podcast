import { sendRawEmail, type RawEmail } from '../../../src/lib/email'

// Cloudflare Pages Function → POST /api/email/send (production).
// The SAME-ORIGIN email proxy. The browser can't reliably reach the raw-email
// endpoint cross-origin (the app is a partitioned iframe, so its muns.io session
// cookie isn't sent), and we never want the service token in the client bundle.
// So all on-demand sends (subscribe welcome, "email this edition") POST here, and
// this holds MUNSHOT_EMAIL_TOKEN server-side and relays with it.
//
//   body: { to, subject, text } | { to, subject, html }
//   env:  MUNSHOT_EMAIL_TOKEN — the service token authorizing server-to-server sends
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const onRequestPost = async (context: { request: Request; env: { MUNSHOT_EMAIL_TOKEN?: string } }): Promise<Response> => {
  let body: { to?: unknown; subject?: unknown; text?: unknown; html?: unknown }
  try {
    body = (await context.request.json()) as typeof body
  } catch {
    return json(400, { ok: false, message: 'Invalid request.' })
  }
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const subject = typeof body.subject === 'string' ? body.subject : ''
  const text = typeof body.text === 'string' ? body.text : undefined
  const html = typeof body.html === 'string' ? body.html : undefined
  if (!to || !subject || (!!text === !!html)) return json(400, { ok: false, message: 'A recipient, subject, and exactly one of text or html are required.' })

  const msg: RawEmail = html ? { email: to, subject, html } : { email: to, subject, text: text as string }
  const res = await sendRawEmail(msg, { token: context.env?.MUNSHOT_EMAIL_TOKEN })
  return json(res.ok ? 200 : 502, res)
}
