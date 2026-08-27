# Munshot Podcasts — Podcast Intelligence

> Choose podcasts → get one-page AI summaries → double-click what's interesting → read one weekly master summary.

A minimal, editorial dashboard that turns the podcasts you care about into a passive intelligence layer. This repo is a **polished UI prototype**: every screen is real and interactive, driven by realistic mock data through a typed API seam (`src/lib/api.ts`) so a live backend drops in without touching the components.

Built for a tech & investing listener tracking shows like **Stratechery, Invest Like the Best, All-In, Odd Lots, The AI Daily Brief, In Good Company, Acquired,** and **Cheeky Pint**.

![stack](https://img.shields.io/badge/React-18-blue) ![stack](https://img.shields.io/badge/Vite-5-646cff) ![stack](https://img.shields.io/badge/Tailwind-3-38bdf8) ![stack](https://img.shields.io/badge/TypeScript-5-3178c6)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## What's in the box

The product's 13 core features, each mapped to where it lives in the UI:

| # | Feature | Where |
|---|---------|-------|
| 1 | Podcast / YouTube selection | **Discover** — search by name or paste an RSS / Spotify show / YouTube URL, add to your library ([paid sources](#paid-and-members-only-sources)) |
| 2 | Automatic new-episode detection | **Home** processing queue + **Episodes** status column |
| 3 | Transcript ingestion | Status pipeline + the **Transcript** tab |
| 4 | One-page AI summary | **Episode → Summary** (Executive Synthesis) |
| 5 | Key takeaways | Blue accent-bar modules on Home, Episode, Weekly |
| 6 | Q&A summary | **Episode → Q&A** |
| 7 | Interesting moments | **Episode → Summary** ("double-click" cards with *why it matters*) |
| 8 | Transcript with highlights | **Episode → Transcript** — highlighted spans ↔ Intelligence Modules |
| 9 | Weekly master summary | **Weekly Summary** — overview, themes, interesting, takeaways, contradictions, mentions, questions, citations |
| 10 | Episode history / archive | **Episodes** — searchable, filterable table |
| 11 | Search | **Search** — episodes, podcasts, people, companies, themes, moments |
| 12 | Processing status | `detected → fetching → transcribing → summarizing → ready / failed` everywhere, with a pipeline view on non-ready episodes |
| 13 | Basic settings | **Settings** — manage feeds, summary length, weekly toggle, email notifications |

See [`FEASIBILITY.md`](./FEASIBILITY.md) for the per-feature buildability assessment.

## Paid and members-only sources

Not every show can be ingested, and Discover says so on the card rather than failing
quietly later. Every search result carries an **access** state (`FeedAccess` in
[`src/lib/types.ts`](./src/lib/types.ts)):

| State | Badge | What it means | Trackable |
|-------|-------|---------------|-----------|
| `open` | Free | Public feed; every episode is fetched and summarized | ✅ |
| `partial` | Partly paid | Public feed, but paid items arrive as a teaser only | ✅ (free items) |
| `private` | Your member feed | A personal member feed — the one route to paid episodes | ✅ (all of them) |
| `paid` | Paid | Subscriber-only; no feed exists for us to fetch | ❌ locked |
| `closed` | No feed | Free at the source, but it publishes no feed (a platform exclusive) | ❌ locked |

`paid` and `closed` render as locked cards, so a paywalled show can never imply
episodes we're able to transcribe. Where the state comes from:

- **Spotify show URLs** ([`server/spotify.ts`](./server/spotify.ts)) — Spotify
  publishes no feed for anyone, so a pasted show link resolves to the show's real
  public RSS when one exists (matched on the exact title), and otherwise to a
  labelled card. Free vs. subscriber-only comes from Spotify's own embed payload
  (`isPlayable` / `playabilityReason`), keylessly — no Spotify app credentials.
- **Member feeds** (`memberFeedInfo` in [`src/lib/knownSources.ts`](./src/lib/knownSources.ts))
  — recognized by membership host (Passport, Supercast, Supporting Cast, Memberful,
  Patreon, Glow, Steady) or by a credential-bearing query param. Best-effort by
  design: recognizing one earns the private badge and a keep-it-secret warning, and
  missing one costs nothing — the feed is still fetched and tracked as normal.
- **Known paywalled shows** (`KNOWN_SHOWS`, same file) — a small hand-verified
  registry for the shows in the customer's lineup. A directory search can't list a
  show that has no public feed (searching "Stratechery" in Apple returns Sharp Tech,
  Exponent and Acquired — everything except Stratechery), so the registry supplies
  that show as one pooled card: what's paid, what's free, and where the member feed
  comes from. It is shared by the browser fast path and the server so both produce
  the same show with the same id.

### One show, one pooled feed

A show that publishes to several places is ONE entry in Discover and ONE episode
list. Its feeds are fetched together and merged with duplicates removed
([`src/lib/pool.ts`](./src/lib/pool.ts)), because the alternative — three lookalike
shows and three summaries of the same instalment — is worse than useless.

The merge is a **union, not a pick**. For each instalment: audio from whichever feed
has it (so the episode becomes transcribable), the longest text (an article body beats
a video description), the YouTube watch link when one exists (it plays in-app), the
earliest publish date, and the title without the platform's channel branding. The
result is richer material than any single source, and the free sources keep working
when the paid one is absent. Two rules keep de-duplication honest: items from the
*same* feed are never merged (a feed's own items are distinct by definition), and
titles must match *and* publish within 45 days — a reused heading a year later is its
own episode. Each episode discloses which sources carried it (`Episode.sources`).

**Stratechery** is the worked example. Its four sources pool into one show — verified
live: 30 raw items in, 12 episodes out, 3 of them merged across sources, no duplicate
titles:

| Source | Access | What it contributes |
|--------|--------|--------------------|
| [Spotify show](https://open.spotify.com/show/1jRACH7L8EQCYKc5uW7aPk) | `paid` | nothing fetchable — subscriber-only, no public feed |
| [YouTube channel](https://www.youtube.com/@Stratechery) | `open` | the weekly video + its watch link, free |
| [stratechery.com/feed](https://stratechery.com/feed/) | `partial` | free articles in full; paid Updates as teasers |
| `…passport.online/feed/podcast/<token>` | `private` | the paid audio (→ transcription), with durations |
| `…passport.online/feed/rss/<token>` | `private` | the paid articles in full text |

Pasting a member feed adds it to the *same* pooled show rather than creating a second
one — the publisher's feed host identifies which show it belongs to. Both Passport
feeds are worth adding: one carries the audio, the other the full text, and pooled
they give an episode with both.

Known limitation: Stratechery's Passport feeds carry the Articles, not the daily
Updates, so those still arrive as public teasers (~150 characters) and summarize
thinly. That's what `partial` means on the card, and it's the publisher's choice of
what to syndicate — not something a different feed URL fixes.

### Member feed credentials

**No token is stored in this repo.** The registry holds only the publisher's feed
*host* and the account page a subscriber copies their own URL from.

For normal use nothing needs configuring: the user pastes their member feed in
Discover and it's persisted with their tracked shows (`localStorage` + the per-user
channel roster in KV), exactly like any other `feedUrl`, and the app fetches their
paid episodes from then on. The UI says on the card that the URL is a credential.

The one path that can't see a user's feed is the **Monday digest cron** — it has no
user session and builds one shared edition from the seed shows. `MEMBER_FEEDS`
(see [`.env.example`](./.env.example)) exists for that case only, and is inert unless
set. Set it on single-tenant deployments only: the seed episode list is shared, so a
member feed there exposes one subscriber's paid content to every visitor of that
space.

## Architecture

```
src/
  lib/
    types.ts        # the domain model — the UI ⇄ backend contract
    mock-data.ts    # realistic sample content (real podcast lineup)
    api.ts          # ← THE SEAM. async functions; swap mock for fetch()
    knownSources.ts # paywalled shows + their free/member sources (shared with server/)
    format.ts       # duration / date / status helpers
  store/
    AppData.tsx     # loads everything through the api seam, provides via context
    Player.tsx      # docked media-player state
  components/        # Sidebar, TopBar, MediaPlayer, CoverTile, StatusBadge, …
  pages/             # Home, Discover, Episodes, EpisodeDetail, Weekly, Settings, Search
```

**The seam.** No component imports mock data directly. Each function in `api.ts` returns exactly the shape a real endpoint would, e.g.

```ts
export const listEpisodes = () =>
  fetch('/api/episodes').then((r) => r.json() as Promise<Episode[]>)
```

Replace the bodies and the UI is live.

### Design system

Clean, minimal, editorial SaaS. A near-white `#fafbfc` canvas, white cards with subtle borders + faint shadows, **Inter** type, and a single bright blue accent (`#2563eb`) reserved for actions and active states. Green denotes a ready summary. Tokens live in [`tailwind.config.js`](./tailwind.config.js) — the whole app re-skins from that one file. Cover art is generated from each show's brand color + monogram (an SVG), so the prototype ships with zero external image dependencies.

## Per-user sign-in inside chat.muns.io

Embedded in chat.muns.io, every user gets their own roster + processed history
(KV keys scoped by the Munshot identity), while episode summaries stay one
global cache shared by everyone. The dashboard side is fully wired
(`src/lib/munshot.ts` — it announces `dashboard:ready` and consumes
`host:init`), **but the host platform must send the other half of the
handshake**: chat.muns.io currently embeds dashboards without any host-side
SDK, so the sidebar badge shows "Not signed in".

→ Drop [`munshot-host-snippet.js`](./munshot-host-snippet.js) into the
chat.muns.io dashboards page (it initializes every dashboard iframe with the
signed-in user's context and answers late `dashboard:ready` announcements).
To rehearse the whole flow locally, open `localhost:5173/embed-harness.html`
during `vite dev` — it simulates a correctly-behaving host, user switching
included.

### Downloads inside the iframe (PDF + Word)

The dashboard iframe is sandboxed `allow-scripts allow-same-origin allow-popups
allow-forms allow-downloads` — note **no `allow-modals`**, which per the HTML
spec turns every script-initiated `window.print()` into a silent no-op for the
whole frame tree. So the PDF is **not** produced by the browser's print → Save
as PDF; it's generated as a real `.pdf` with a library (jsPDF) and handed over
as a Blob download — exactly the model the Word `.doc` export already uses, and
the one delivery (`allow-downloads`) that always works inside that sandbox.
`src/lib/pdfRender.ts` draws the full house style as vector — the dark gradient
cover (painted to a canvas, embedded as the cover image), gold section rules,
the drop-cap lead, diamond-bullet idea cards, the dark quote panel, and the
zebra source table — with real, selectable text. Fonts follow the same serif/
sans/mono split as the `.doc` (Times / Helvetica / Courier ≈ Georgia / Calibri /
Consolas), the standard PDF families, so nothing needs embedding.

## Weekly email digest (the Monday send) + the PDF report

The weekly brief is **investable-research-grade**, modelled on Guidepoint AskGP:
a synthesised cross-episode **Overview** (with `[n]` citations), thematic
**Key Points**, a **Quantitative Summary** table, a **Comparison Across Sources**
table, and grouped **Sources**. Each episode also carries an *investable insight*
(what changed · why it matters · who benefits · who's at risk · diligence
questions — `server/summarize.ts`, `SUMMARY_REVISION` r7), which the weekly
synthesis (`synthesizeWeekly`) rolls up across the week. The on-screen Weekly
page, the emailed brief, the PDF, and the Word export all render this one shape.

**The email is a brief that links to a hosted PDF.** The raw-email endpoint can't
carry attachments, so the cron renders the edition to a real `.pdf` (jsPDF —
`weeklyPdfBytes` in `src/lib/pdfRender.ts`), stores the bytes in KV keyed by a
content hash (`server/reportStore.ts`, served at `GET /api/report/:id`, 30-day
TTL), and sends a polished HTML brief with a prominent **Download full PDF
report** button.

**All sends route through our own origin.** The app is a partitioned iframe, so a
cross-origin browser send to the raw-email endpoint can't carry the muns.io
session cookie (this was the *"Couldn't reach the email service"* bug). Instead,
subscribe-welcome and "Email this edition" POST to `POST /api/email/send`
(`functions/api/email/send.ts`), which holds the service token server-side and
relays it — the browser never sees the token.

Because Cloudflare Pages can't run cron itself, the Monday timer is a scheduled
**GitHub Actions** workflow ([`.github/workflows/weekly-digest.yml`](./.github/workflows/weekly-digest.yml))
that POSTs `/api/cron/weekly-digest`. It assembles the edition server-side
(`server/weeklyDigest.ts` → `assembleWeekly` + `synthesizeWeekly` with a
deterministic fallback), renders + hosts the PDF, and mails every subscriber.
Only episodes summarised **and** published in the last 7 days are included; with
none, it skips (never an empty email).

### Keeping the schedule alive

GitHub disables scheduled workflows in a **public** repo after 60 days with no
repository activity — which would stop `weekly-digest.yml`, and with it the
auto-processing below, with no sign of it inside the app (the Weekly page would
simply start showing a growing "still queued" count again).

[`.github/workflows/keep-schedules-alive.yml`](./.github/workflows/keep-schedules-alive.yml)
guards that. It runs weekly and does **nothing** while the repo is active; only once
there has been no commit for `STALE_AFTER_DAYS` (50, leaving margin under GitHub's
60) does it push a one-line heartbeat, which counts as repository activity and resets
the clock. Normal development never produces a heartbeat commit.

GitHub also emails the repo owner before disabling a schedule, and it can be
re-enabled from the Actions tab in one click — this just means nobody has to notice
that email.

### Auto-processing

Every tick of that same workflow — not just the send — summarises a bounded batch
of the week's pending episodes (`processPendingBatch`), writing each to the shared
summary cache. That is what makes episodes turn **ready** on their own: nobody has
to open the app, and the "Catch up now" button on Weekly Summary is only a *skip
the wait* shortcut, never a required step.

The batch works over the seed shows **plus every user-added channel** on the
stored rosters. `collectTrackedChannels` (`server/channelStore.ts`) scans the KV
roster keys — the anonymous `channels:v1` and each per-user `u:<uid>:channels:v1` —
and `getAllEpisodes` (`server/feeds.ts`) pools those feeds in with the seed
sources. Untracked shows and entries with no feed are skipped, so a channel
somebody deselected never costs an LLM call. A roster longer than
`CHANNELS_PER_TICK` is covered across consecutive ticks (the window rotates by a
tick index) rather than starving its tail.

Before this, the batch saw only the hardcoded `SOURCES` list, so anything added
from Discover sat *detected* forever and could only be summarised by hand.

The **emailed** edition stays seed-only on purpose: it is one edition shared by
every subscriber, and `PODCASTS` (its show lookup) knows only the seed shows —
folding one user's private additions in would put their channels in everyone
else's inbox. Their episodes are still summarised, so the app shows them ready.

**Setup — Pages env + repo secrets:**

| Where | Name | Purpose |
|-------|------|---------|
| Pages project (Settings → Variables) | `MUNSHOT_EMAIL_TOKEN` | **Service** token authorizing server-to-server sends (the "god token"). Used by the cron *and* the `/api/email/send` proxy. Store as an **encrypted secret** — never commit it. |
| Pages project | `CRON_SECRET` | Bearer token guarding `/api/cron/weekly-digest`. |
| Pages project | `SITE_URL` | Deployed origin, e.g. `https://podcast-afg.pages.dev` — required to build an absolute link to the hosted PDF (a cron has no request). |
| Pages project | `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) + optional `SUMMARY_MODEL` | The summariser. Use a strong model (e.g. `claude-opus-4-8`) — the investable-insight + quant extraction quality scales with model strength. |
| GitHub repo (Settings → Secrets → Actions) | `SITE_URL`, `CRON_SECRET` | Same values as the Pages vars. |

Trigger it by hand any time from the Actions tab (**workflow_dispatch**) to test.
Locally, `vite dev` mirrors every route (`/api/email/send`, `/api/report/:id`,
`/api/cron/weekly-digest`); set `MUNSHOT_EMAIL_TOKEN` + `SITE_URL` in `.env` /
`.env.local` to exercise real sends. The cron is open locally when no
`CRON_SECRET` is set.

## What's mocked vs. real

- **Real:** every screen, route, interaction, status pipeline, search, settings, tracking toggles, the docked player UI, highlight ↔ summary linking.
- **Mocked:** the data itself (in `mock-data.ts`) and a ~240ms simulated latency in `api.ts`. No audio actually plays; transcription/LLM/RSS are represented by sample output.

## Next steps to go live

1. Implement `api.ts` against a backend (episode rows, summaries, transcripts).
2. RSS/YouTube polling worker → writes `detected` episodes.
3. Transcript ingest endpoint (the customer supplies the transcription API).
4. Claude summarization pass → fills `synthesis / takeaways / qa / moments`, returning quoted spans for the transcript highlights.
5. Weekly aggregation job (summary-of-summaries) + email digest. ✅ **Done** — see [Weekly email digest](#weekly-email-digest-the-monday-send).
