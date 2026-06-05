import { Link } from 'react-router-dom'
import { usePlayer } from '../store/Player'
import { useAppData } from '../store/AppData'
import { formatClock } from '../lib/format'
import { CoverTile } from './CoverTile'
import { Icon } from './Icon'

// Apple-style docked player. Appears once something is "playing"; the prototype
// drives the UI only (no real audio).
export function MediaPlayer() {
  const { episode, isPlaying, progress, toggle } = usePlayer()
  const { podcastById } = useAppData()

  if (!episode) return null
  const podcast = podcastById(episode.podcastId)
  const played = Math.round(episode.durationSec * progress)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-lg pb-4 pl-[calc(16rem+2rem)]">
      <div className="pointer-events-auto mx-auto flex max-w-container items-center gap-md rounded-2xl border border-outline-variant bg-surface/85 px-md py-2.5 shadow-player backdrop-blur-xl">
        {/* Now playing */}
        <div className="flex min-w-0 flex-1 items-center gap-sm">
          {podcast && <CoverTile podcast={podcast} className="h-11 w-11 shrink-0" />}
          <div className="min-w-0">
            <p className="truncate text-metadata font-semibold text-on-surface">{episode.title}</p>
            <p className="truncate text-[11px] text-secondary">
              {podcast?.title} · {formatClock(played)} / {formatClock(episode.durationSec)}
            </p>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-1">
          <button className="grid h-9 w-9 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-primary" aria-label="Back 15s">
            <Icon name="replay_10" size={22} />
          </button>
          <button
            onClick={toggle}
            className="grid h-11 w-11 place-items-center rounded-full bg-primary text-on-primary shadow-sm transition-transform active:scale-90"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <Icon name={isPlaying ? 'pause' : 'play_arrow'} size={26} fill />
          </button>
          <button className="grid h-9 w-9 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-primary" aria-label="Forward 30s">
            <Icon name="forward_30" size={22} />
          </button>
        </div>

        {/* Progress + summary jump */}
        <div className="hidden flex-1 items-center gap-sm md:flex">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
          <Link
            to={`/episodes/${episode.id}`}
            className="flex items-center gap-1.5 rounded-lg chip-signal px-2.5 py-1.5 text-metadata font-semibold transition-opacity hover:opacity-80"
          >
            <Icon name="auto_awesome" size={16} />
            Summary
          </Link>
        </div>
      </div>
    </div>
  )
}
