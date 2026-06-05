import type { Episode, Podcast } from '../lib/types'
import { episodeSourceUrl, sourceLabel } from '../lib/source'

interface SourceLinkProps {
  episode: Episode
  podcast?: Podcast
  /** 'button' = labelled pill (headers); 'icon' = compact brand glyph (list rows). */
  variant?: 'button' | 'icon'
  className?: string
}

// Branded "Listen on Apple Podcasts" / "Watch on YouTube" link, opening the
// episode at its origin in a new tab. The brand mark makes the destination
// recognisable at a glance instead of a generic glyph.
export function SourceLink({ episode, podcast, variant = 'button', className = '' }: SourceLinkProps) {
  const href = episodeSourceUrl(episode, podcast)
  const label = sourceLabel(podcast)
  const youtube = podcast?.source === 'youtube'

  if (variant === 'icon') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={label}
        aria-label={label}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-surface-container ${className}`}
      >
        <SourceMark youtube={youtube} size={18} />
      </a>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`group inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface py-2 pl-2 pr-3.5 text-metadata font-semibold text-on-surface transition-colors hover:border-primary/40 hover:bg-surface-container-low ${className}`}
    >
      <SourceMark youtube={youtube} size={22} />
      {label}
    </a>
  )
}

// Recognisable platform mark: Apple Podcasts (purple gradient + mic) or
// YouTube (red rounded-rect + play). Drawn as SVG so it stays crisp at any size.
function SourceMark({ youtube, size }: { youtube: boolean; size: number }) {
  if (youtube) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-[5px]"
        style={{ width: size, height: size, background: '#FF0000' }}
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
    )
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[6px]"
      style={{ width: size, height: size, background: 'linear-gradient(150deg, #E96CFF 0%, #C961DE 40%, #7C2FB8 100%)' }}
    >
      {/* Apple-Podcasts-style microphone: a dot + three broadcast arcs. */}
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8.6" r="2.1" fill="#fff" />
        <path
          d="M12 13.2c-2.2 0-4 1.5-4 3.4 0 1.2 1.8 2 4 2s4-.8 4-2c0-1.9-1.8-3.4-4-3.4Z"
          fill="#fff"
        />
        <path
          d="M6.2 6.1a8 8 0 0 1 11.6 0M8.2 8.2a5.1 5.1 0 0 1 7.6 0"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.85"
        />
      </svg>
    </span>
  )
}
