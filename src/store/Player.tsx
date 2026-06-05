import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Episode } from '../lib/types'

// Pure client-side "now playing" state for the docked media player. No real
// audio in the prototype — this drives the player UI and play/pause affordances.

interface PlayerState {
  episode: Episode | null
  isPlaying: boolean
  /** 0–1 scrub position (mocked). */
  progress: number
  play: (episode: Episode) => void
  toggle: () => void
}

const Ctx = createContext<PlayerState | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [episode, setEpisode] = useState<Episode | null>(null)
  const [isPlaying, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0.13)

  const play = useCallback((next: Episode) => {
    setEpisode((cur) => {
      if (cur?.id !== next.id) setProgress(0.02)
      return next
    })
    setPlaying(true)
  }, [])

  const toggle = useCallback(() => setPlaying((p) => !p), [])

  const value = useMemo<PlayerState>(
    () => ({ episode, isPlaying, progress, play, toggle }),
    [episode, isPlaying, progress, play, toggle],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePlayer(): PlayerState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePlayer must be used within <PlayerProvider>')
  return ctx
}
