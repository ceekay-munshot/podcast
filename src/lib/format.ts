import type { ProcessingStatus } from './types'

/** 6420 → "1h 47m" · 2520 → "42m". */
export function formatDuration(totalSeconds: number): string {
  // Round to whole minutes FIRST, then split — rounding minutes independently of
  // the hour division produced "60m" (e.g. 3599s) and "1h 60m" (e.g. 7170s).
  const total = Number.isFinite(totalSeconds) ? Math.round(Math.max(0, totalSeconds) / 60) : 0
  const h = Math.floor(total / 60)
  const m = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** 6420 → "1:47:00" for the media player clock. */
export function formatClock(totalSeconds: number): string {
  const secs = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const DAY = 86_400_000

/** ISO date → "Today" / "Yesterday" / "3d ago" / "Apr 12". */
export function relativeDate(iso: string, now = NOW): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '' // unparseable date → render nothing, never "Invalid Date"
  const days = Math.floor((startOfDay(now) - startOfDay(then)) / DAY)
  if (days < 0) return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) // future-dated → absolute, not "Today"
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** ISO date → "May 28, 2026". */
export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Real wall-clock now, so live feed dates filter and read correctly.
export const NOW = Date.now()

export interface StatusMeta {
  label: string
  icon: string
  /** Tailwind classes for the pill. */
  tone: string
  spin?: boolean
  pulse?: boolean
  /** Dot color class when pulse is set. */
  dot?: string
}

export function statusMeta(status: ProcessingStatus): StatusMeta {
  switch (status) {
    case 'ready':
      return { label: 'Ready', icon: 'check_circle', tone: 'bg-success-container text-on-success-container', pulse: true, dot: 'bg-success' }
    case 'summarizing':
      return { label: 'Summarizing', icon: 'progress_activity', tone: 'chip-signal', spin: true }
    case 'transcribing':
      return { label: 'Transcribing', icon: 'progress_activity', tone: 'chip-signal', spin: true }
    case 'fetching':
      return { label: 'Fetching', icon: 'progress_activity', tone: 'chip-signal', spin: true }
    case 'detected':
      return { label: 'Detected', icon: 'fiber_new', tone: 'bg-surface-container text-on-surface-variant' }
    case 'failed':
      return { label: 'Failed', icon: 'error', tone: 'bg-error-container text-on-error-container' }
  }
}

/** Position of a status in the pipeline, for progress bars (0–1). */
export function statusProgress(status: ProcessingStatus): number {
  const order: ProcessingStatus[] = ['detected', 'fetching', 'transcribing', 'summarizing', 'ready']
  const i = order.indexOf(status)
  if (status === 'failed' || i < 0) return 0 // unknown status → 0, never a negative bar
  return i / (order.length - 1)
}
