import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDateRange } from '../store/DateRange'
import { Icon } from './Icon'

export function TopBar() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const { preset, presets, setPreset, rangeLabel } = useDateRange()
  const [dateOpen, setDateOpen] = useState(false)

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
          <button className="hidden items-center gap-2 whitespace-nowrap rounded-xl border border-outline-variant bg-surface px-3 py-2 text-[13px] font-medium text-on-surface transition-colors hover:bg-surface-container-low md:flex">
            <span className="grid h-4 w-4 place-items-center rounded bg-inverse-surface text-[8px] font-bold text-white">M</span>
            All Channels
            <Icon name="expand_more" size={18} className="text-outline" />
          </button>

          {/* Date range — wired to the global DateRange store */}
          <div className="relative hidden lg:block">
            <button
              onClick={() => setDateOpen((o) => !o)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors ${
                dateOpen ? 'border-primary bg-surface-container-low text-on-surface' : 'border-outline-variant bg-surface text-on-surface hover:bg-surface-container-low'
              }`}
            >
              <Icon name="calendar_today" size={16} className="text-outline" />
              {rangeLabel}
              <Icon name="expand_more" size={18} className={`text-outline transition-transform ${dateOpen ? 'rotate-180' : ''}`} />
            </button>

            {dateOpen && (
              <>
                <button className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setDateOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-52 rounded-xl border border-outline-variant bg-surface p-1 shadow-card-hover">
                  <p className="px-2.5 py-1.5 text-label-caps uppercase text-outline">Filter by date</p>
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setPreset(p.id)
                        setDateOpen(false)
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[14px] transition-colors ${
                        preset.id === p.id ? 'bg-primary-fixed/50 font-semibold text-primary' : 'text-on-surface hover:bg-surface-container-low'
                      }`}
                    >
                      {p.label}
                      {preset.id === p.id && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

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
