# SignalCast — Podcast Intelligence

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
| 1 | Podcast / YouTube selection | **Discover** — search by name or paste an RSS/YouTube URL, add to your library |
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

## Architecture

```
src/
  lib/
    types.ts        # the domain model — the UI ⇄ backend contract
    mock-data.ts    # realistic sample content (real podcast lineup)
    api.ts          # ← THE SEAM. async functions; swap mock for fetch()
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

SignalCast — *"signal over noise."* A paper-like `#f9f9f9` canvas, white cards with 24px radii and 1px `#c1c6d7` borders, **Inter** type, and a single blue accent (`#0058bc`) reserved for actions, citations, and active states. Tokens live in [`tailwind.config.js`](./tailwind.config.js). Cover art is generated from each show's brand color + monogram (an SVG), so the prototype ships with zero external image dependencies.

## What's mocked vs. real

- **Real:** every screen, route, interaction, status pipeline, search, settings, tracking toggles, the docked player UI, highlight ↔ summary linking.
- **Mocked:** the data itself (in `mock-data.ts`) and a ~240ms simulated latency in `api.ts`. No audio actually plays; transcription/LLM/RSS are represented by sample output.

## Next steps to go live

1. Implement `api.ts` against a backend (episode rows, summaries, transcripts).
2. RSS/YouTube polling worker → writes `detected` episodes.
3. Transcript ingest endpoint (the customer supplies the transcription API).
4. Claude summarization pass → fills `synthesis / takeaways / qa / moments`, returning quoted spans for the transcript highlights.
5. Weekly aggregation job (summary-of-summaries) + email digest.
