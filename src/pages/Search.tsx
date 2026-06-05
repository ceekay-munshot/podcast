import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import { longDate } from '../lib/format'
import type { Episode } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { RichText, entityTerms } from '../components/RichText'
import { StatusBadge } from '../components/StatusBadge'
import { SectionLabel } from '../components/SectionLabel'

export default function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const { episodes, podcasts, podcastById, weekly } = useAppData()

  const needle = q.trim().toLowerCase()

  const results = useMemo(() => {
    if (!needle) return null
    const match = (s: string) => s.toLowerCase().includes(needle)

    const eps = episodes.filter(
      (e) =>
        match(e.title) ||
        match(e.blurb) ||
        e.entities.people.some(match) ||
        e.entities.companies.some(match) ||
        e.entities.themes.some(match) ||
        (e.summary?.synthesis.some(match) ?? false),
    )

    const pods = podcasts.filter((p) => match(p.title) || match(p.author) || match(p.description) || match(p.category))

    // Distinct entities across the corpus that match.
    const entitySet = (pick: (e: Episode) => string[]) => {
      const counts = new Map<string, number>()
      episodes.forEach((e) => pick(e).forEach((v) => match(v) && counts.set(v, (counts.get(v) ?? 0) + 1)))
      return [...counts.entries()].sort((a, b) => b[1] - a[1])
    }
    const people = entitySet((e) => e.entities.people)
    const companies = entitySet((e) => e.entities.companies)
    const themes = entitySet((e) => e.entities.themes)

    const moments = episodes.flatMap((e) =>
      (e.summary?.moments ?? [])
        .filter((m) => match(m.title) || match(m.whyItMatters))
        .map((m) => ({ episode: e, moment: m })),
    )

    return { eps, pods, people, companies, themes, moments }
  }, [needle, episodes, podcasts])

  const total = results ? results.eps.length + results.pods.length + results.moments.length : 0

  return (
    <div className="mx-auto max-w-reading animate-fade-up">
      <h2 className="mb-md text-display-lg text-on-background">Search</h2>

      <div className="relative mb-lg">
        <Icon name="search" size={22} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-outline" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
          placeholder="Episodes, transcripts, people, companies, themes, moments…"
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest py-3.5 pl-12 pr-4 text-body-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Empty state → suggestions */}
      {!needle && (
        <div>
          <SectionLabel className="mb-sm">Try a theme from this week</SectionLabel>
          <div className="flex flex-wrap gap-sm">
            {weekly?.topThemes.map((t) => (
              <button
                key={t.label}
                onClick={() => setParams({ q: t.label })}
                className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface px-md py-2 text-metadata text-on-surface transition-colors hover:border-primary hover:text-primary"
              >
                <Icon name="tag" size={15} /> {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {results && (
        <>
          <p className="mb-lg text-metadata text-secondary">
            {total} result{total === 1 ? '' : 's'} for “{q}”
          </p>

          {/* Mentions */}
          {(results.people.length > 0 || results.companies.length > 0 || results.themes.length > 0) && (
            <section className="mb-xl">
              <SectionLabel className="mb-sm">Mentions</SectionLabel>
              <div className="flex flex-wrap gap-sm">
                {[
                  ...results.people.map((e) => ['person', e] as const),
                  ...results.companies.map((e) => ['domain', e] as const),
                  ...results.themes.map((e) => ['tag', e] as const),
                ].map(([icon, [name, count]]) => (
                  <button
                    key={name}
                    onClick={() => setParams({ q: name })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant bg-surface px-3 py-1.5 text-metadata text-on-surface transition-colors hover:border-primary hover:text-primary"
                  >
                    <Icon name={icon} size={15} className="text-secondary" />
                    {name}
                    <span className="text-[12px] text-secondary">{count}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Episodes */}
          {results.eps.length > 0 && (
            <section className="mb-xl">
              <SectionLabel className="mb-sm">Episodes · {results.eps.length}</SectionLabel>
              <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest">
                {results.eps.map((ep) => {
                  const podcast = podcastById(ep.podcastId)
                  return (
                    <Link
                      key={ep.id}
                      to={`/episodes/${ep.id}`}
                      className="flex items-center gap-md border-b border-outline-variant p-sm transition-colors last:border-b-0 hover:bg-surface-container-low"
                    >
                      {podcast && <CoverTile podcast={podcast} className="h-11 w-11 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-md font-semibold text-on-surface">{ep.title}</p>
                        <p className="truncate text-metadata text-secondary">
                          {podcast?.title} · {longDate(ep.publishedAt)}
                        </p>
                      </div>
                      <StatusBadge status={ep.status} compact />
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* Podcasts */}
          {results.pods.length > 0 && (
            <section className="mb-xl">
              <SectionLabel className="mb-sm">Podcasts · {results.pods.length}</SectionLabel>
              <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                {results.pods.map((p) => (
                  <Link
                    key={p.id}
                    to="/discover"
                    className="flex items-center gap-md rounded-xl border border-outline-variant bg-surface-container-lowest p-sm transition-shadow hover:shadow-card"
                  >
                    <CoverTile podcast={p} className="h-11 w-11 shrink-0" showSource />
                    <div className="min-w-0">
                      <p className="truncate text-body-md font-semibold text-on-surface">{p.title}</p>
                      <p className="truncate text-metadata text-secondary">{p.category}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Interesting moments */}
          {results.moments.length > 0 && (
            <section className="mb-xl">
              <SectionLabel className="mb-sm">Interesting moments · {results.moments.length}</SectionLabel>
              <div className="space-y-sm">
                {results.moments.map(({ episode, moment }) => (
                  <Link
                    key={moment.id}
                    to={`/episodes/${episode.id}`}
                    className="block rounded-xl border border-outline-variant bg-surface-container-lowest p-md transition-shadow hover:shadow-card"
                  >
                    <div className="mb-1 flex items-center justify-between gap-sm">
                      <p className="text-metadata font-bold text-on-surface">{moment.title}</p>
                      <span className="shrink-0 rounded bg-surface-container-high px-2 py-0.5 text-label-caps text-on-surface-variant">
                        {moment.timestamp}
                      </span>
                    </div>
                    <p className="text-[14px] leading-relaxed text-on-surface-variant">
                      <RichText text={moment.whyItMatters} terms={entityTerms(episode.entities)} />
                    </p>
                    <p className="mt-1.5 text-[12px] text-secondary">{podcastById(episode.podcastId)?.title}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {total === 0 && results.people.length === 0 && results.themes.length === 0 && (
            <div className="grid place-items-center gap-sm py-xl text-center">
              <Icon name="search_off" size={32} className="text-outline" />
              <p className="text-body-md text-secondary">No matches yet. Try a company, person, or theme.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
