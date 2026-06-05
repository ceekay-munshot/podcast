import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'

export function TopBar() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search')
  }

  return (
    <header className="sticky top-0 z-40 h-16 border-b border-outline-variant bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-container items-center justify-between gap-md px-lg">
        <form onSubmit={onSubmit} className="group relative flex-1 max-w-md">
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-outline transition-colors group-focus-within:text-primary"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transcripts, people, companies, themes…"
            className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pl-11 pr-sm text-body-md text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </form>

        <div className="flex items-center gap-xs">
          <button
            type="button"
            className="relative grid h-10 w-10 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            aria-label="Notifications"
          >
            <Icon name="notifications" />
            <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full border-2 border-surface bg-primary" />
          </button>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
            aria-label="Account"
          >
            <Icon name="account_circle" fill />
          </button>
        </div>
      </div>
    </header>
  )
}
