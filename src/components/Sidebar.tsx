import { useEffect, useRef } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { WeeklySubscribe } from './WeeklySubscribe'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/episodes', label: 'Episodes', icon: 'play_circle' },
  { to: '/weekly', label: 'Weekly Summary', icon: 'bar_chart' },
  { to: '/discover', label: 'Discover', icon: 'explore' },
]

/** The static sidebar — desktop/tablet only; below `md` the drawer takes over. */
export function Sidebar() {
  return (
    <nav className="fixed left-0 top-0 z-50 hidden h-screen w-64 flex-col border-r border-outline-variant bg-surface px-3 py-5 md:flex">
      <SidebarContent />
    </nav>
  )
}

/** The same nav as a left drawer for small viewports. Stays mounted (CSS handles
 *  enter/exit + visibility) so a fast open→close retargets mid-animation. */
export function MobileSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  // While open: focus moves into the drawer (Esc backs out, focus returns to
  // the ☰ trigger) and the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.()
    }
  }, [open, onClose])

  return (
    <div id="mobile-nav" data-open={open} className="drawer fixed inset-0 z-[60] md:hidden" aria-hidden={!open}>
      {/* Scrim — click closes */}
      <button
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="drawer-scrim absolute inset-0 cursor-default bg-inverse-surface/40"
      />
      <nav
        ref={panelRef}
        tabIndex={-1}
        aria-label="Navigation"
        className="drawer-panel absolute left-0 top-0 flex h-full w-64 flex-col border-r border-outline-variant bg-surface px-3 py-5 shadow-card-hover focus:outline-none"
      >
        <SidebarContent onNavigate={onClose} onClose={onClose} />
      </nav>
    </div>
  )
}

function SidebarContent({ onNavigate, onClose }: { onNavigate?: () => void; onClose?: () => void }) {
  return (
    <>
      <div className="mb-7 flex items-center justify-between">
        {/* Brand — links to Home */}
        <Link
          to="/"
          aria-label="Munshot — go to Home"
          onClick={onNavigate}
          className="press flex items-center gap-2.5 rounded-lg px-2 py-1 hover:opacity-90"
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] shadow-sm"
            style={{ background: 'linear-gradient(150deg, #2a2e38 0%, #0c0e13 100%)' }}
          >
            <img src="/munshot-logo.png" alt="Munshot" className="h-7 w-7 object-contain" />
          </span>
          <span className="text-[19px] font-bold tracking-tight text-on-surface">Munshot</span>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close navigation"
            className="press grid h-9 w-9 place-items-center rounded-lg text-secondary hover:bg-surface-container-low hover:text-on-surface"
          >
            <Icon name="close" size={20} />
          </button>
        )}
      </div>

      {/* Primary nav */}
      <ul className="flex flex-col gap-1">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} onClick={onNavigate} className={navClass}>
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={20} fill={isActive} />
                  <span className="text-[14px]">{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
        {/* Weekly-brief subscription — small bell that opens a popup */}
        <li className="mt-0.5">
          <WeeklySubscribe />
        </li>
      </ul>
    </>
  )
}

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'press-soft flex items-center gap-3 rounded-lg px-3 py-2.5',
    isActive
      ? 'bg-primary-fixed/60 font-semibold text-primary'
      : 'font-medium text-secondary hover:bg-surface-container-low hover:text-on-surface',
  ].join(' ')
}
