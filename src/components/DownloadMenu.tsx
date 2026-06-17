import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

// The Download control: a primary button that drops down two formats — the
// institution-grade PDF (full design, via the browser's Save-as-PDF) and the
// editable Word .doc. Shared by the Weekly and Episode pages.
export function DownloadMenu({ onPdf, onWord, disabled }: { onPdf: () => void; onWord: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (fn: () => void) => {
    setOpen(false)
    fn()
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Download this summary"
        className="press inline-flex items-center gap-2 rounded-lg bg-primary px-md py-2.5 text-metadata font-semibold text-on-primary hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="download" size={18} /> Download <Icon name={open ? 'expand_less' : 'expand_more'} size={18} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest p-1.5 shadow-card-hover"
        >
          <MenuItem
            icon="picture_as_pdf"
            title="PDF"
            subtitle="Full design · downloads a .pdf"
            onClick={() => pick(onPdf)}
          />
          <MenuItem icon="description" title="Word (.doc)" subtitle="Editable document" onClick={() => pick(onWord)} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, title, subtitle, onClick }: { icon: string; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-surface-container-low"
    >
      <Icon name={icon} size={20} className="shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-on-surface">{title}</span>
        <span className="block truncate text-[11.5px] text-secondary">{subtitle}</span>
      </span>
    </button>
  )
}
