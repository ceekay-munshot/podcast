import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/episodes', label: 'Episodes', icon: 'play_circle' },
  { to: '/weekly', label: 'Weekly Summary', icon: 'bar_chart' },
]

export function Sidebar() {
  return (
    <nav className="fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-outline-variant bg-surface px-3 py-5">
      {/* Brand */}
      <div className="mb-7 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-on-primary shadow-sm">
          <span className="text-[16px] font-extrabold leading-none">M</span>
        </span>
        <span className="text-[19px] font-bold tracking-tight text-on-surface">Munshot</span>
      </div>

      {/* Primary nav */}
      <ul className="flex flex-1 flex-col gap-1">
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
      </ul>
    </nav>
  )
}

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
    isActive
      ? 'bg-primary-fixed/60 font-semibold text-primary'
      : 'font-medium text-secondary hover:bg-surface-container-low hover:text-on-surface',
  ].join(' ')
}
