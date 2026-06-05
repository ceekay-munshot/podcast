import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { subscribeWeekly, unsubscribeWeekly } from '../lib/api'
import { Icon } from './Icon'

// Weekly-digest subscription as a compact sidebar bell + popover.
// Persists locally; the actual send is wired through api.subscribeWeekly
// (see the SEAM in lib/api.ts).
const SUB_KEY = 'munshot:weekly-subscription'

export function WeeklySubscribe() {
  const [open, setOpen] = useState(false)
  const [stored, setStored] = useState<string | null>(null)
  const [email, setEmail] = useState('ceekay@muns.io')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SUB_KEY)
      if (saved) {
        setStored(saved)
        setEmail(saved)
      }
    } catch {
      /* localStorage unavailable — fine, just won't persist */
    }
  }, [])

  async function subscribe(e: FormEvent) {
    e.preventDefault()
    const addr = email.trim()
    if (!addr || busy) return
    setBusy(true)
    try {
      const res = await subscribeWeekly(addr)
      if (res.subscribed) {
        try {
          localStorage.setItem(SUB_KEY, res.email)
        } catch {
          /* ignore */
        }
        setStored(res.email)
      }
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    if (busy) return
    setBusy(true)
    try {
      await unsubscribeWeekly(stored ?? email)
      try {
        localStorage.removeItem(SUB_KEY)
      } catch {
        /* ignore */
      }
      setStored(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      {/* Trigger — a small bell row, styled like the nav items above it */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Weekly brief email"
        aria-expanded={open}
        className={`press-soft flex w-full items-center gap-3 rounded-lg px-3 py-2.5 ${
          open ? 'bg-surface-container-low text-on-surface' : 'font-medium text-secondary hover:bg-surface-container-low hover:text-on-surface'
        }`}
      >
        <span className="relative">
          <Icon
            name={stored ? 'notifications_active' : 'notifications'}
            size={20}
            fill={!!stored}
            className={stored ? 'text-primary' : ''}
          />
          {stored && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-surface" />}
        </span>
        <span className="text-[14px]">Weekly brief</span>
      </button>

      {open && (
        <>
          {/* click-away */}
          <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
          <div className="pop absolute bottom-0 left-full z-50 ml-2 w-72 origin-bottom-left rounded-xl border border-outline-variant bg-surface p-md shadow-card-hover">
            {stored ? (
              <>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
                    <Icon name="mark_email_read" size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-on-surface">You're subscribed</p>
                    <p className="truncate text-[12px] text-secondary">{stored}</p>
                  </div>
                </div>
                <p className="mb-3 text-[12px] text-secondary">One email every Monday with the whole weekly summary.</p>
                <button
                  onClick={unsubscribe}
                  disabled={busy}
                  className="press w-full rounded-lg border border-outline-variant bg-surface px-md py-2 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-60"
                >
                  {busy ? 'Updating…' : 'Unsubscribe'}
                </button>
              </>
            ) : (
              <form onSubmit={subscribe}>
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full chip-signal">
                    <Icon name="mail" size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-on-surface">Weekly brief in your inbox</p>
                    <p className="text-[12px] text-secondary">Every Monday — this whole summary.</p>
                  </div>
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="mb-2 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-[14px] outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="press flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-md py-2.5 text-[14px] font-semibold text-on-primary hover:bg-primary-container disabled:opacity-60"
                >
                  <Icon name="notifications_active" size={16} /> {busy ? 'Subscribing…' : 'Subscribe'}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}
