import { Outlet } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { Icon } from './Icon'

export function Layout() {
  const { loading } = useAppData()

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 flex min-h-screen flex-col">
        <TopBar />
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
