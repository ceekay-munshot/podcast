import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppData } from '../store/AppData'
import type { Settings as SettingsType } from '../lib/types'
import { Icon } from '../components/Icon'

const LENGTHS: SettingsType['summaryLength'][] = ['concise', 'standard', 'detailed']

export default function Settings() {
  const { podcasts, settings, saveSettings } = useAppData()
  const [tab, setTab] = useState<'preferences' | 'account'>('preferences')
  const trackedCount = podcasts.filter((p) => p.tracked).length

  function update(patch: Partial<SettingsType>) {
    saveSettings({ ...settings, ...patch })
  }

  return (
    <div className="mx-auto max-w-reading animate-fade-up">
      <h2 className="text-display-lg text-on-background">Settings</h2>

      {/* Tabs */}
      <div className="mb-lg mt-md flex gap-lg border-b border-outline-variant">
        {(['preferences', 'account'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-2.5 text-[14px] capitalize transition-colors ${
              tab === t ? 'border-primary font-semibold text-primary' : 'border-transparent text-secondary hover:text-on-surface'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'preferences' ? (
        <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-card">
          {/* Summary length */}
          <Row title="AI Summary Length" hint="Choose the default length for AI-generated summaries.">
            <div className="flex rounded-lg border border-outline-variant bg-surface-container-low p-0.5">
              {LENGTHS.map((l) => (
                <button
                  key={l}
                  onClick={() => update({ summaryLength: l })}
                  className={`rounded-md px-4 py-1.5 text-[13px] capitalize transition-colors ${
                    settings.summaryLength === l ? 'bg-surface font-semibold text-primary shadow-sm' : 'text-secondary hover:text-on-surface'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </Row>

          {/* Weekly */}
          <Row title="Weekly Master Summary" hint="Receive one aggregated summary across all your podcasts.">
            <Toggle checked={settings.weeklySummary} onChange={(v) => update({ weeklySummary: v })} />
          </Row>

          {/* Email */}
          <Row title="Email Notifications" hint="Get notified when summaries are ready.">
            <Toggle checked={settings.emailNotifications} onChange={(v) => update({ emailNotifications: v })} />
          </Row>

          {/* Manage channels */}
          <Row title="Manage Tracked Podcasts" hint={`You are tracking ${trackedCount} channels.`} last>
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant bg-surface px-md py-2 text-metadata font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <Icon name="tune" size={16} /> Manage Channels
            </Link>
          </Row>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-card">
          <Row title="Name" hint="Shown on shared summaries.">
            <input
              defaultValue="Chiraag Kapil"
              className="w-56 rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary"
            />
          </Row>
          <Row title="Notification Email" hint="Where digests and alerts are sent." last>
            <input
              type="email"
              value={settings.email}
              onChange={(e) => update({ email: e.target.value })}
              placeholder="you@example.com"
              className="w-56 rounded-lg border border-outline-variant bg-surface px-3 py-2 text-[14px] outline-none focus:border-primary"
            />
          </Row>
        </div>
      )}
    </div>
  )
}

function Row({ title, hint, children, last }: { title: string; hint: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-md p-lg ${last ? '' : 'border-b border-outline-variant'}`}>
      <div className="min-w-0">
        <p className="text-body-md font-semibold text-on-surface">{title}</p>
        <p className="mt-0.5 text-metadata text-secondary">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
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
  )
}
