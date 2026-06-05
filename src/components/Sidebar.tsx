import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

const MAIN = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/discover', label: 'Discover', icon: 'travel_explore' },
  { to: '/episodes', label: 'Episodes', icon: 'library_music' },
  { to: '/weekly', label: 'Weekly Summary', icon: 'summarize' },
]

const FOOTER = [
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/search', label: 'Search', icon: 'search' },
]

export function Sidebar() {
  return (
    <nav className="fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-outline-variant bg-surface px-sm py-lg">
      {/* Brand */}
      <div className="mb-xl px-sm">
        <div className="mb-base flex items-center gap-xs">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-on-primary">
            <Icon name="graphic_eq" size={20} fill />
          </span>
          <h1 className="text-display-sm font-bold tracking-tight text-primary">SignalCast</h1>
        </div>
        <p className="px-base text-metadata text-secondary">Podcast Intelligence</p>
      </div>

      {/* Primary nav */}
      <ul className="flex flex-1 flex-col gap-base">
        {MAIN.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={navClass}>
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={20} fill={isActive} />
                  <span className="text-body-md">{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Footer nav */}
      <ul className="mt-auto flex flex-col gap-base border-t border-outline-variant pt-lg">
        {FOOTER.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} className={navClass}>
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={20} fill={isActive} />
                  <span className="text-body-md">{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* User chip */}
      <div className="mt-lg flex items-center gap-sm px-sm">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-fixed text-[12px] font-bold text-on-primary-container">
          CK
        </span>
        <div className="min-w-0">
          <p className="truncate text-metadata font-semibold text-on-surface">Chiraag Kapil</p>
          <p className="truncate text-[11px] text-secondary">Founding plan</p>
        </div>
      </div>
    </nav>
  )
}

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-md rounded-lg px-sm py-2.5 transition-colors',
    isActive
      ? 'bg-surface-container font-semibold text-primary'
      : 'text-secondary hover:bg-surface-container-low hover:text-on-surface',
  ].join(' ')
}
