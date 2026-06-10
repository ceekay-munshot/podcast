import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { MobileSidebar, Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Icon } from './Icon'

export function Layout() {
  const { loading } = useAppData()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Navigating anywhere dismisses the drawer (covers back/forward too).
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname, location.search])

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="flex min-h-screen flex-col md:ml-64">
        <TopBar menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 px-lg pb-lg pt-lg">
          <div className="mx-auto max-w-container">{loading ? <LoadingState /> : <Outlet />}</div>
        </main>
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid place-items-center py-[20vh] text-secondary">
      <Icon name="graphic_eq" size={36} className="mb-sm motion-safe:animate-pulse text-primary" />
      <p className="text-metadata">Loading your intelligence feed…</p>
    </div>
  )
}
