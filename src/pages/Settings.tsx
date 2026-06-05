import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import type { Settings as SettingsType } from '../lib/types'
import { CoverTile } from '../components/CoverTile'
import { Icon } from '../components/Icon'
import { SectionLabel } from '../components/SectionLabel'

const LENGTHS: { id: SettingsType['summaryLength']; label: string; hint: string }[] = [
  { id: 'concise', label: 'Concise', hint: '~½ page · just the signal' },
  { id: 'standard', label: 'Standard', hint: '~1 page · the default' },
  { id: 'detailed', label: 'Detailed', hint: '~2 pages · full context' },
]

export default function Settings() {
  const { podcasts, settings, toggleTracked, saveSettings } = useAppData()
  const tracked = podcasts.filter((p) => p.tracked)

  function update(patch: Partial<SettingsType>) {
    saveSettings({ ...settings, ...patch })
  }

  return (
    <div className="mx-auto max-w-reading animate-fade-up">
      <header className="mb-lg flex items-center justify-between">
        <div>
          <h2 className="text-display-lg text-on-background">Settings</h2>
          <p className="mt-1 text-body-md text-secondary">Keep it minimal. Tune what you track and how summaries read.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-metadata text-secondary">
          <Icon name="cloud_done" size={16} className="text-success" /> All changes saved
        </span>
      </header>

      {/* Tracked podcasts */}
      <Panel>
        <div className="mb-md flex items-center justify-between">
          <div>
            <SectionLabel>Tracked podcasts</SectionLabel>
            <p className="mt-1 text-metadata text-secondary">{tracked.length} sources feeding your intelligence layer.</p>
          </div>
          <Link
            to="/discover"
            className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant px-md py-2 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container"
          >
            <Icon name="add" size={16} /> Add source
          </Link>
        </div>
        <ul className="divide-y divide-outline-variant">
          {tracked.map((p) => (
            <li key={p.id} className="flex items-center gap-md py-2.5">
              <CoverTile podcast={p} className="h-10 w-10 shrink-0" showSource />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-md font-semibold text-on-surface">{p.title}</p>
                <p className="truncate text-metadata text-secondary">
                  {p.author} · {p.cadence}
                </p>
              </div>
              <button
                onClick={() => toggleTracked(p.id)}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-metadata font-semibold text-on-surface-variant transition-colors hover:bg-error-container hover:text-on-error-container"
              >
                <Icon name="close" size={16} /> Remove
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {/* Summary length */}
      <Panel>
        <SectionLabel>Summary length</SectionLabel>
        <p className="mb-md mt-1 text-metadata text-secondary">How long should each episode's one-page summary be?</p>
        <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
          {LENGTHS.map((l) => {
            const active = settings.summaryLength === l.id
            return (
              <button
                key={l.id}
                onClick={() => update({ summaryLength: l.id })}
                className={`rounded-xl border p-md text-left transition-all ${
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-outline-variant hover:bg-surface-container-low'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className={`text-body-md font-semibold ${active ? 'text-primary' : 'text-on-surface'}`}>{l.label}</span>
                  {active && <Icon name="check_circle" size={18} fill className="text-primary" />}
                </div>
                <span className="text-[12px] text-secondary">{l.hint}</span>
              </button>
            )
          })}
        </div>
      </Panel>

      {/* Notifications */}
      <Panel>
        <SectionLabel>Digest & notifications</SectionLabel>
        <div className="mt-md divide-y divide-outline-variant">
          <ToggleRow
            title="Weekly master summary"
            hint="One aggregated summary across every tracked show, every Monday."
            checked={settings.weeklySummary}
            onChange={(v) => update({ weeklySummary: v })}
          />
          <ToggleRow
            title="Email notifications"
            hint="Email me when a high-signal episode is ready and when the weekly lands."
            checked={settings.emailNotifications}
            onChange={(v) => update({ emailNotifications: v })}
          />
        </div>
        {settings.emailNotifications && (
          <div className="mt-md">
            <label className="mb-1 block text-metadata font-semibold text-on-surface">Notification email</label>
            <input
              type="email"
              value={settings.email}
              onChange={(e) => update({ email: e.target.value })}
              placeholder="you@example.com"
              className="w-full max-w-sm rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-md outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
        )}
      </Panel>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="mb-gutter rounded-2xl border border-outline-variant bg-surface-container-lowest p-lg">{children}</section>
}

function ToggleRow({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-md py-md first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-body-md font-semibold text-on-surface">{title}</p>
        <p className="text-metadata text-secondary">{hint}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-surface-container-highest'}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
