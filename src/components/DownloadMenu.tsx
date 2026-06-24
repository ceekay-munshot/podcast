import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

type EmailState = 'idle' | 'sending' | 'sent' | 'error'

// The Download control: a primary button that drops down two formats — the
// institution-grade PDF (full design) and the editable Word .doc. Shared by the
// Weekly and Episode pages. When `onEmail` is provided, a third item delivers the
// same document to the user's inbox and owns its own send lifecycle: clicking it
// keeps the menu open, swaps to a spinner while sending, then settles into a
// green "Email sent" (which breathes, then auto-closes) or a red, retryable
// error — so the outcome is always visible right where the user clicked.
export function DownloadMenu({
  onPdf,
  onWord,
  onEmail,
  emailSubtitle,
  disabled,
}: {
  onPdf: () => void
  onWord: () => void
  /** Resolves to the send result; rejection is treated as a failure. */
  onEmail?: () => Promise<{ ok: boolean; message?: string }>
  /** Caption under the "Email to me" item, e.g. the destination address. */
  emailSubtitle?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState<EmailState>('idle')
  const [emailMsg, setEmailMsg] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside-click / Escape — but never mid-send, so the status stays on
  // screen until it resolves.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (email === 'sending') return
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && email !== 'sending') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, email])

  // A closed menu always reopens to a clean slate.
  useEffect(() => {
    if (!open) setEmail('idle')
  }, [open])

  // Let the green "sent" state breathe before the menu dismisses itself.
  useEffect(() => {
    if (email !== 'sent') return
    const t = setTimeout(() => setOpen(false), 1900)
    return () => clearTimeout(t)
  }, [email])

  const pick = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  const runEmail = async () => {
    if (!onEmail || email === 'sending' || email === 'sent') return
    setEmail('sending')
    try {
      const res = await onEmail()
      if (res.ok) setEmail('sent')
      else {
        setEmailMsg(res.message || "Couldn't send — try again")
        setEmail('error')
      }
    } catch {
      setEmailMsg("Couldn't send — check your connection")
      setEmail('error')
    }
  }

  const addr = emailSubtitle?.replace(/^To\s+/i, '')
  const v = {
    idle: { icon: 'mail', fill: false, title: 'Email to me', sub: emailSubtitle ?? 'Designed HTML to your inbox', tone: 'idle' as const },
    sending: { icon: 'progress_activity', fill: false, title: 'Sending…', sub: 'Delivering this edition', tone: 'idle' as const },
    sent: { icon: 'mark_email_read', fill: true, title: 'Email sent', sub: addr ? `Sent to ${addr}` : 'Sent to your inbox', tone: 'success' as const },
    error: { icon: 'error', fill: true, title: "Couldn't send", sub: emailMsg || 'Tap to try again', tone: 'error' as const },
  }[email]
  const toneText = v.tone === 'success' ? 'text-on-success-container' : v.tone === 'error' ? 'text-on-error-container' : ''

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download this summary"
        className="press inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="download" size={18} /> Download <Icon name={open ? 'expand_less' : 'expand_more'} size={18} />
      </button>

      {open && (
        <div
          role="menu"
          className="pop absolute right-0 z-50 mt-1.5 w-60 origin-top-right overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-1.5 shadow-card-hover"
        >
          <MenuItem icon="picture_as_pdf" title="PDF" subtitle="Full design · downloads a .pdf" onClick={() => pick(onPdf)} />
          <MenuItem icon="description" title="Word (.doc)" subtitle="Editable document" onClick={() => pick(onWord)} />
          {onEmail && (
            <button
              role="menuitem"
              onClick={runEmail}
              disabled={email === 'sending' || email === 'sent'}
              className={`press-soft flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left disabled:cursor-default ${
                v.tone === 'success' ? 'bg-success-container' : v.tone === 'error' ? 'bg-error-container' : 'hover:bg-surface-container-low'
              }`}
            >
              {/* Re-keyed per state so the new glyph pops in (node-pop); the spinner also rotates. */}
              <span key={email} className="node-pop grid h-5 w-5 shrink-0 place-items-center">
                <Icon
                  name={v.icon}
                  size={20}
                  fill={v.fill}
                  className={`${toneText || 'text-primary'} ${email === 'sending' ? 'animate-spin' : ''}`}
                />
              </span>
              <span className="min-w-0" aria-live="polite">
                <span className={`block text-[14px] font-semibold ${toneText || 'text-on-surface'}`}>{v.title}</span>
                <span className={`block truncate text-[11.5px] ${v.tone === 'idle' ? 'text-secondary' : toneText}`}>{v.sub}</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function MenuItem({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: string
  title: string
  subtitle: string
  onClick: () => void
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="press-soft flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-container-low"
    >
      <Icon name={icon} size={20} className="shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-on-surface">{title}</span>
        <span className="block truncate text-[11.5px] text-secondary">{subtitle}</span>
      </span>
    </button>
  )
}
