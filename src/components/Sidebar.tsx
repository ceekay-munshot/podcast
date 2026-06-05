import { Link, NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { WeeklySubscribe } from './WeeklySubscribe'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/episodes', label: 'Episodes', icon: 'play_circle' },
  { to: '/weekly', label: 'Weekly Summary', icon: 'bar_chart' },
]

export function Sidebar() {
  return (
    <nav className="fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-outline-variant bg-surface px-3 py-5">
      {/* Brand — links to Home */}
      <Link to="/" aria-label="Munshot — go to Home" className="press mb-7 flex items-center gap-2.5 rounded-lg px-2 py-1 hover:opacity-90">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] shadow-sm"
          style={{ background: 'linear-gradient(150deg, #2a2e38 0%, #0c0e13 100%)' }}
        >
          <img src="/munshot-logo.png" alt="Munshot" className="h-7 w-7 object-contain" />
        </span>
        <span className="text-[19px] font-bold tracking-tight text-on-surface">Munshot</span>
      </Link>

      {/* Primary nav */}
      <ul className="flex flex-col gap-1">
        {NAV.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={navClass}>
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
    </nav>
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
