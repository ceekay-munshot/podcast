import type { Episode, Podcast } from '../lib/types'
import { episodeSourceUrl, sourceIcon, sourceLabel } from '../lib/source'
import { Icon } from './Icon'

interface SourceLinkProps {
  episode: Episode
  podcast?: Podcast
  /** 'button' = labelled pill (headers); 'icon' = compact glyph (list rows). */
  variant?: 'button' | 'icon'
  className?: string
}

// Opens the episode at its origin (Apple Podcasts / YouTube) in a new tab.
// stopPropagation keeps it safe inside clickable rows.
export function SourceLink({ episode, podcast, variant = 'button', className = '' }: SourceLinkProps) {
  const href = episodeSourceUrl(episode, podcast)
  const label = sourceLabel(podcast)
  const icon = sourceIcon(podcast)

  if (variant === 'icon') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={label}
        aria-label={label}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-secondary transition-colors hover:bg-surface-container hover:text-primary ${className}`}
      >
        <Icon name={icon} size={18} />
      </a>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2.5 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low ${className}`}
    >
      <Icon name={icon} size={18} /> {label}
    </a>
  )
}
