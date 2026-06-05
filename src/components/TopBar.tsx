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
    <header className="sticky top-0 z-40 h-16 border-b border-outline-variant bg-surface/85 backdrop-blur-md">
      <div className="flex h-full items-center gap-md px-lg">
        {/* Search */}
        <form onSubmit={onSubmit} className="group relative w-full max-w-xl">
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-outline transition-colors group-focus-within:text-primary"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search episodes, podcasts, people, companies…"
            className="w-full rounded-xl border border-outline-variant bg-surface-container-low py-2.5 pl-11 pr-sm text-[14px] text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary focus:bg-surface"
          />
        </form>

        <div className="ml-auto flex items-center gap-2.5">
          {/* Channel filter (cosmetic in the prototype) */}
          <button className="hidden items-center gap-2 rounded-xl border border-outline-variant bg-surface whitespace-nowrap px-3 py-2 text-[13px] font-medium text-on-surface transition-colors hover:bg-surface-container-low md:flex">
            <span className="grid h-4 w-4 place-items-center rounded bg-inverse-surface text-[8px] font-bold text-white">M</span>
            All Channels
            <Icon name="expand_more" size={18} className="text-outline" />
          </button>

          {/* Date range (cosmetic) */}
          <button className="hidden items-center gap-2 rounded-xl border border-outline-variant bg-surface whitespace-nowrap px-3 py-2 text-[13px] font-medium text-on-surface transition-colors hover:bg-surface-container-low lg:flex">
            <Icon name="calendar_today" size={16} className="text-outline" />
            May 30 – Jun 5, 2026
            <Icon name="expand_more" size={18} className="text-outline" />
          </button>

          {/* Account */}
          <button className="flex items-center gap-1.5 rounded-full pl-0.5 transition-opacity hover:opacity-80" aria-label="Account">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-primary-fixed text-[12px] font-bold text-on-primary-container">
              CK
            </span>
            <Icon name="expand_more" size={18} className="text-outline" />
          </button>
        </div>
      </div>
    </header>
  )
}
