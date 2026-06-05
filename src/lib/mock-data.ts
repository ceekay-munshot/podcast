import type { Episode, Podcast, WeeklySummary } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Mock data. Modelled on the customer's actual lineup (Stratechery, Invest Like
// the Best, All-In, Odd Lots, The AI Daily Brief, In Good Company, Acquired,
// Cheeky Pint, Access…) so the prototype reads like the real product. Swap this
// file's exports for live API responses without touching any component.
// ─────────────────────────────────────────────────────────────────────────────

export const PODCASTS: Podcast[] = [
  {
    id: 'stratechery',
    title: 'Stratechery',
    author: 'Ben Thompson',
    category: 'Tech Strategy',
    description: `Ben Thompson's analysis of the strategy and business behind technology and media, and the impact of technology on society.`,
    cadence: '3–4 / week',
    episodeCount: 312,
    source: 'podcast',
    color: '#0058bc',
    monogram: 'ST',
    tracked: false, // members-only, no public feed — can't be ingested
    locked: true,
  },
  {
    id: 'iltb',
    title: 'Invest Like the Best',
    author: "Patrick O'Shaughnessy",
    category: 'Investing',
    description: `Conversations with the best investors and operators in the world, exploring markets, ideas, and the craft of capital allocation.`,
    cadence: 'Weekly',
    episodeCount: 401,
    source: 'podcast',
    color: '#1c7d52',
    monogram: 'IB',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/61/ae/be/61aebe7a-06e8-7390-3ae5-f2fc5889e36c/mza_10827489189939068066.jpg/600x600bb.jpg',
    tracked: true,
  },
  {
    id: 'allin',
    title: 'All-In',
    author: 'Chamath, Sacks, Friedberg & Calacanis',
    category: 'Tech · Economy',
    description: `Four industry insiders riff on the week in tech, markets, politics, and the economy. Equal parts signal and banter.`,
    cadence: 'Weekly',
    episodeCount: 184,
    source: 'youtube',
    color: '#1a1c1c',
    monogram: 'AI',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts124/v4/c7/d2/92/c7d292ea-44b3-47ff-2f5e-74fa5b23db6c/mza_7005270671777648882.png/600x600bb.jpg',
    tracked: true,
  },
  {
    id: 'oddlots',
    title: 'Odd Lots',
    author: 'Joe Weisenthal & Tracy Alloway',
    category: 'Markets',
    description: `Bloomberg's Joe and Tracy go deep on the niche corners of markets, economics, and the plumbing of the financial system.`,
    cadence: '2–3 / week',
    episodeCount: 720,
    source: 'podcast',
    color: '#b3541e',
    monogram: 'OL',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/f3/99/6a/f3996a52-e4a4-bf0d-b7d6-e376c4058568/mza_15550359494736224565.jpg/600x600bb.jpg',
    tracked: true,
  },
  {
    id: 'aidaily',
    title: 'The AI Daily Brief',
    author: 'Nathaniel Whittemore',
    category: 'Artificial Intelligence',
    description: `A daily briefing on the most important news and discussion in AI — what happened, and why it matters for builders and investors.`,
    cadence: 'Daily',
    episodeCount: 540,
    source: 'podcast',
    color: '#5b3fa8',
    monogram: 'AD',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/9c/78/d8/9c78d82d-a2d1-a026-6ca2-f92ea61be9ae/mza_18421328158594577747.jpg/600x600bb.jpg',
    tracked: true,
  },
  {
    id: 'ingoodcompany',
    title: 'In Good Company',
    author: 'Nicolai Tangen',
    category: 'Investing · Leadership',
    description: `The CEO of Norway's $1.7T sovereign wealth fund interviews the leaders of the companies it owns.`,
    cadence: 'Weekly',
    episodeCount: 96,
    source: 'podcast',
    color: '#0a6e6e',
    monogram: 'GC',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/91/46/0d/91460d4a-134f-9b4c-1444-1947ca2f7ee0/mza_2926898652345635132.jpeg/600x600bb.jpg',
    tracked: true,
  },
  {
    id: 'acquired',
    title: 'Acquired',
    author: 'Ben Gilbert & David Rosenthal',
    category: 'Business History',
    description: `Every company has a story. Ben and David tell the ones worth knowing — the great acquisitions and IPOs, in deep detail.`,
    cadence: 'Bi-weekly',
    episodeCount: 214,
    source: 'podcast',
    color: '#2f6f4f',
    monogram: 'AQ',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/43/c5/fb/43c5fbdf-b302-053a-2704-ba5f74322625/mza_13119989780540450831.jpg/600x600bb.jpg',
    tracked: true,
  },
  {
    id: 'cheekypint',
    title: 'Cheeky Pint',
    author: 'John Collison (Stripe)',
    category: 'Tech · Founders',
    description: `Stripe co-founder John Collison sits down over a pint with the operators and builders he finds most interesting.`,
    cadence: 'Bi-weekly',
    episodeCount: 22,
    source: 'youtube',
    color: '#635bff',
    monogram: 'CP',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/39/58/7b/39587b37-a6e1-e96b-593d-621d5ec5292a/mza_6705197557754043928.jpg/600x600bb.jpg',
    tracked: true,
  },
  // ── Discover suggestions (not yet tracked) ──────────────────────────────────
  {
    id: 'access',
    title: 'Access',
    author: 'Alex Heath (The Verge)',
    category: 'Tech',
    description: `Alex Heath's interviews with the people shaping the future of technology, AI, and the platforms we live on.`,
    cadence: 'Weekly',
    episodeCount: 34,
    source: 'youtube',
    color: '#d83b3b',
    monogram: 'AX',
    tracked: false, // no resolvable public feed — can't be ingested
    locked: true,
  },
  {
    id: 'bg2',
    title: 'BG2',
    author: 'Brad Gerstner & Bill Gurley',
    category: 'Strategy',
    description: `Two of tech investing's sharpest minds break down the most important stories in technology and markets.`,
    cadence: 'Weekly',
    episodeCount: 28,
    source: 'podcast',
    color: '#1f3a8a',
    monogram: 'BG',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/PodcastSource126/v4/4b/ab/e5/4babe58b-7cda-b2b3-40a5-bcac3f262764/33f9cff7-dc0b-4293-a5bf-d8cc62ab8c98.jpg/600x600bb.jpg',
    tracked: false,
  },
  {
    id: 'lennys',
    title: "Lenny's Podcast",
    author: 'Lenny Rachitsky',
    category: 'Product',
    description: `Interviews with world-class product leaders and growth experts on how to build, ship, and scale great products.`,
    cadence: 'Weekly',
    episodeCount: 142,
    source: 'youtube',
    color: '#e0792b',
    monogram: 'LP',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/c7/80/a3/c780a365-a1ed-527f-365f-1bd3e51ac6d1/mza_5908526734339724450.jpg/600x600bb.jpg',
    tracked: false,
  },
  {
    id: 'benmarc',
    title: 'The Ben & Marc Show',
    author: 'Ben Horowitz & Marc Andreessen',
    category: 'Venture',
    description: `a16z's founders on technology, markets, culture, and the future — unfiltered.`,
    cadence: 'Monthly',
    episodeCount: 48,
    source: 'youtube',
    color: '#111827',
    monogram: 'BM',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Podcasts116/v4/44/51/1c/44511c70-c19e-c12f-0907-7465d9217cbf/mza_13427686079111565317.jpg/600x600bb.jpg',
    tracked: false,
  },
]

export const EPISODES: Episode[] = [
  // ── 1. Stratechery — fully analysed, with transcript + highlights ──────────
  {
    id: 'ep-stratechery-agg',
    podcastId: 'stratechery',
    title: 'Aggregation Theory Meets Generative AI',
    publishedAt: '2026-06-04',
    durationSec: 2940,
    status: 'ready',
    signal: 'high',
    blurb: `AI doesn't kill the aggregators — it hands them their next moat. Why distribution still beats models, and where the value actually accrues.`,
    entities: {
      people: ['Ben Thompson', 'Sam Altman', 'Satya Nadella', 'Mark Zuckerberg'],
      companies: ['OpenAI', 'Google', 'Meta', 'Microsoft', 'Nvidia'],
      themes: ['Aggregation Theory', 'AI moats', 'Distribution', 'Attention economy'],
    },
    summary: {
      synthesis: [
        `Ben revisits Aggregation Theory through the lens of generative AI and lands on a counter-consensus take: **the incumbents who own demand are the most likely winners**, not the labs that own the models. Models are converging in capability and falling in price, which makes them **a cost center, not a moat**. The durable advantage is the same as it ever was — **owning the user relationship and the distribution surface** where AI gets consumed.`,
        `The episode draws a sharp line between **"AI as a feature"** and **"AI as a business"**. Companies with an existing aggregation surface (Search, Feed, Office, iOS) can fold AI in at **near-zero marginal customer-acquisition cost**. Pure-play model providers, by contrast, **must buy distribution at brutal prices** — which is exactly why they keep partnering with the very incumbents they hoped to disrupt.`,
        `Ben closes on the attention economy: if generation cost collapses to zero, **scarcity migrates from content to attention and trust**. The platforms that already arbitrate attention inherit the surplus. The provocative implication for founders is that the best AI businesses may look less like "an LLM wrapper" and more like **a wedge into someone's distribution**.`,
      ],
      takeaways: [
        {
          title: 'Models are a cost center, not a moat',
          detail: `Capability is converging and inference prices are in freefall. Owning a frontier model is increasingly table stakes, not a durable edge.`,
        },
        {
          title: 'Distribution is the only scarce asset',
          detail: `Whoever owns the demand surface folds AI in at zero CAC. Everyone else has to rent that surface at a punishing price.`,
        },
        {
          title: 'The disruptors are renting the incumbents',
          detail: `Labs partnering with Microsoft, Apple, and the hyperscalers is the tell: they need distribution more than the incumbents need their models.`,
        },
        {
          title: 'Scarcity moves from content to trust',
          detail: `When generation is free, the premium accrues to whoever curates attention and vouches for quality — a re-bundling, not an unbundling.`,
        },
      ],
      qa: [
        {
          q: `If models are commoditizing, why are the labs still worth so much?`,
          a: `Ben argues a chunk of the valuation is an option on AGI plus a bet on a consumer aggregation surface (ChatGPT as the new front page). Strip those out and the core model API looks like a low-margin utility competing on price.`,
        },
        {
          q: `Does this mean startups can't win in AI?`,
          a: `No — but the winning shape is a wedge into a distribution gap the incumbents can't serve, not a thinner, cheaper model. Own a workflow and the data exhaust around it, then let the model commoditize underneath you.`,
        },
        {
          q: `Where does Nvidia sit in this framing?`,
          a: `Nvidia is the picks-and-shovels exception: it sells to everyone in the war and is insulated from the distribution fight — until custom silicon and supply normalization erode the premium.`,
        },
      ],
      moments: [
        {
          id: 'm-st-1',
          title: 'The "models are a cost center" reframe',
          timestamp: '12:40',
          whyItMatters: `Inverts the dominant narrative that owning a frontier model is the prize. If true, it re-rates the entire AI cap table toward the distribution owners.`,
          segmentId: 'st-seg-3',
        },
        {
          id: 'm-st-2',
          title: 'Why OpenAI keeps partnering with its "victims"',
          timestamp: '24:05',
          whyItMatters: `A concrete tell that distribution beats models — the disruptors are quietly renting the incumbents' reach to survive.`,
          segmentId: 'st-seg-5',
        },
        {
          id: 'm-st-3',
          title: 'Attention as the last scarce resource',
          timestamp: '38:18',
          whyItMatters: `Reframes "content is free" into "trust is priceless" — a useful lens for anyone building a media or curation product in the AI era.`,
          segmentId: 'st-seg-7',
        },
      ],
    },
    transcript: [
      {
        id: 'st-seg-1',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '00:42',
        text: `Welcome back. I want to do something a little uncomfortable today, which is to argue against the most popular trade in the entire industry. Everyone believes that whoever owns the best model owns the future. I think that's exactly backwards.`,
      },
      {
        id: 'st-seg-2',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '06:15',
        text: `Aggregation Theory said the companies that win the internet are the ones that own the demand — the user relationship — not the ones that own supply. Supply gets commoditized. So the question I keep asking is: in an AI world, what is supply, and what is demand?`,
      },
      {
        id: 'st-seg-3',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '12:40',
        text: `Here's the thing nobody wants to say out loud. The model is supply. And supply gets commoditized. Capability is converging, inference prices are collapsing, and that means the model is a cost center, not a moat. You don't build a durable franchise on top of something that gets 10x cheaper every 18 months.`,
        highlight: {
          refId: 'm-st-1',
          quote: `the model is a cost center, not a moat`,
          label: 'Models are a cost center',
        },
      },
      {
        id: 'st-seg-4',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '18:30',
        text: `So where does the value accrue? It accrues to whoever owns the surface where AI is actually consumed. Search. The feed. The operating system. The inbox. If you already own demand, you can fold AI in at basically zero customer-acquisition cost.`,
      },
      {
        id: 'st-seg-5',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '24:05',
        text: `And this is the tell. Watch what the labs actually do, not what they say. They say they're disrupting the incumbents. But every one of them has signed a distribution deal with Microsoft, with Apple, with the hyperscalers. They are renting the incumbents' distribution because they have to. That's not the behavior of a winner; that's the behavior of supply.`,
        highlight: {
          refId: 'm-st-2',
          quote: `They are renting the incumbents' distribution because they have to`,
          label: 'Disruptors rent the incumbents',
        },
      },
      {
        id: 'st-seg-6',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '31:50',
        text: `Now, the obvious objection is Nvidia. And Nvidia is the genuine exception — they sell picks and shovels to every army in the war, so they don't have to fight the distribution battle at all. The risk there isn't distribution; it's custom silicon and supply normalizing the margin away.`,
      },
      {
        id: 'st-seg-7',
        speaker: 'Ben Thompson',
        role: 'host',
        timestamp: '38:18',
        text: `Let me end on the part that I find genuinely interesting. If generation cost goes to zero, then content is no longer scarce — attention is, and trust is. The platforms that already arbitrate attention inherit the surplus. So the future isn't an unbundling. It's a re-bundling around trust.`,
        highlight: {
          refId: 'm-st-3',
          quote: `content is no longer scarce — attention is, and trust is`,
          label: 'Attention is the scarce resource',
        },
      },
    ],
  },

  // ── 2. Invest Like the Best — analysed, summary only ───────────────────────
  {
    id: 'ep-iltb-compounders',
    podcastId: 'iltb',
    title: 'Compounding Machines: Inside a Permanent-Capital Mind',
    publishedAt: '2026-06-03',
    durationSec: 4980,
    status: 'ready',
    signal: 'high',
    blurb: `A permanent-capital allocator on why patience is an edge, the three questions he asks before any investment, and avoiding the "diworsification" trap.`,
    entities: {
      people: ["Patrick O'Shaughnessy", 'Henry Singleton', 'Warren Buffett'],
      companies: ['Constellation Software', 'Berkshire Hathaway', 'Teledyne'],
      themes: ['Capital allocation', 'Compounding', 'Permanent capital', 'Incentives'],
    },
    summary: {
      synthesis: [
        `The guest makes the case that **permanent capital is structurally underrated**: by removing redemption risk, it **converts time itself into an edge**. Most investors are forced sellers at the worst moments; a permanent vehicle can be the buyer on the other side, which over decades is where the bulk of the returns hide.`,
        `Much of the conversation is a clinic on incentives. The best decentralized compounders **push capital-allocation authority down to the operators** closest to the cash flows, then hold them to **a hard hurdle rate**. Centralized M&A teams, by contrast, optimize for deal volume because that's what they're paid for — the classic agency problem dressed up as "synergy."`,
        `The episode lands on temperament. Edge isn't a smarter spreadsheet; it's **the behavioral capacity to do nothing for long stretches** and then act decisively when price dislocates from value.`,
      ],
      takeaways: [
        { title: 'Permanent capital turns time into alpha', detail: `No redemptions means you can be the buyer when everyone else is a forced seller — the single biggest structural edge available.` },
        { title: 'Push allocation to the cash flows', detail: `Decentralized operators with a hard hurdle rate beat a central M&A team paid on deal volume.` },
        { title: 'Beware "diworsification"', detail: `Most acquisitions destroy value; the discipline is saying no until the hurdle is cleared with margin.` },
        { title: 'Temperament is the edge', detail: `The hard part isn't the analysis, it's the patience to wait and the nerve to act when price dislocates.` },
      ],
      qa: [
        { q: `What three questions does he ask before any investment?`, a: `Can it compound for a decade-plus? Are the operators' incentives aligned with mine? And what's the downside if I'm wrong about the moat — not the upside if I'm right.` },
        { q: `How does he think about valuation?`, a: `As a margin-of-safety problem, not a precision exercise. He'd rather be roughly right on durability than precisely right on next year's multiple.` },
      ],
      moments: [
        { id: 'm-ib-1', title: 'The forced-seller insight', timestamp: '41:20', whyItMatters: `Reframes "patience" from a virtue into a structural source of returns — being liquid when others must sell.` },
        { id: 'm-ib-2', title: 'Why most M&A teams are mis-incentivized', timestamp: '58:44', whyItMatters: `A clean articulation of the agency problem hiding inside "synergy" — useful for evaluating any acquisitive company.` },
      ],
    },
  },

  // ── 3. Odd Lots — fully analysed, transcript + highlights ──────────────────
  {
    id: 'ep-oddlots-grid',
    podcastId: 'oddlots',
    title: 'Why the Power Grid Became AI’s Hardest Bottleneck',
    publishedAt: '2026-06-02',
    durationSec: 3360,
    status: 'ready',
    signal: 'high',
    blurb: `The binding constraint on AI isn't chips — it's interconnection queues, transformer lead times, and the very unglamorous reality of power.`,
    entities: {
      people: ['Joe Weisenthal', 'Tracy Alloway', 'Brian Janous'],
      companies: ['Microsoft', 'Constellation Energy', 'Vistra'],
      themes: ['Power grid', 'Data centers', 'Interconnection queue', 'Nuclear', 'Transformers'],
    },
    summary: {
      synthesis: [
        `The guest — a former hyperscaler energy lead — argues the AI buildout has quietly become **an electricity story**. The scarce input is no longer GPUs; it's **firm power and the physical gear to deliver it**. Interconnection queues now stretch **past 2,000 days** in parts of the US, which means a data center can be financed, designed, and chip-stocked and still sit dark waiting for a grid connection.`,
        `A surprising amount of the bottleneck is mundane hardware: **large power transformers have multi-year lead times** and are largely built overseas. The conversation ranges, in classic Odd Lots fashion, from the exotic (behind-the-meter nuclear, talk of putting compute where the power is — even half-joking about data centers in space) all the way down to the deeply unglamorous choice of UPS and backup-power topology inside the building.`,
        `The takeaway for investors is that **the value is migrating to whoever controls firm generation and interconnection rights**. Utilities, independent power producers, and anyone sitting on a permitted site with a grid connection suddenly hold a far more valuable asset than the market priced a year ago.`,
      ],
      takeaways: [
        { title: 'Power, not chips, is the binding constraint', detail: `You can buy GPUs with money. You cannot buy a grid interconnection with money — you wait in a queue measured in years.` },
        { title: 'The boring hardware is the bottleneck', detail: `Large power transformers have multi-year lead times and thin global supply. It's a supply-chain story dressed as an AI story.` },
        { title: 'Firm power is the new beachfront', detail: `Permitted sites with interconnection rights and access to baseload are repricing fast. Whoever owns the electrons captures the rents.` },
        { title: 'Behind-the-meter goes mainstream', detail: `Expect more direct deals with nuclear and gas plants to bypass the public queue entirely.` },
      ],
      qa: [
        { q: `Why can't we just build more grid?`, a: `Permitting, transformer supply, and labor. The guest notes a transmission line can take a decade to permit and build — far slower than the 18-month AI capex cycle driving demand.` },
        { q: `Is nuclear actually back?`, a: `For data centers, yes — as a procurement strategy. Restarting shuttered plants and signing behind-the-meter deals is faster than waiting on the public interconnection queue.` },
        { q: `What's the most underpriced asset here?`, a: `An already-permitted site with a signed interconnection agreement. It's effectively an option on the entire AI buildout.` },
      ],
      moments: [
        {
          id: 'm-ol-1',
          title: 'The 2,000-day interconnection queue',
          timestamp: '14:55',
          whyItMatters: `Quantifies the bottleneck in a way that reframes the whole AI capex debate — money can't shortcut a multi-year grid wait.`,
          segmentId: 'ol-seg-3',
        },
        {
          id: 'm-ol-2',
          title: 'From data centers in space to the choice of UPS',
          timestamp: '27:10',
          whyItMatters: `A perfect example of the range of the problem — the same constraint shows up at the cosmic scale and at the literal power-supply level.`,
          segmentId: 'ol-seg-5',
        },
        {
          id: 'm-ol-3',
          title: 'Why utilities are the surprise AI trade',
          timestamp: '34:02',
          whyItMatters: `Names the part of the market that quietly re-rates if power is the true constraint — the un-sexy regulated utility.`,
          segmentId: 'ol-seg-6',
        },
      ],
    },
    transcript: [
      {
        id: 'ol-seg-1',
        speaker: 'Joe Weisenthal',
        role: 'host',
        timestamp: '01:10',
        text: `So everyone's been talking about the chip shortage for two years. But you came on and basically said: forget the chips, the real constraint is somewhere much less glamorous. Walk us through that.`,
      },
      {
        id: 'ol-seg-2',
        speaker: 'Brian Janous',
        role: 'guest',
        timestamp: '02:35',
        text: `Right. The chips are a solvable problem — it's money, it's fabs, it's a supply chain that responds to price. Power is different. You cannot pay your way to the front of an interconnection queue. The electrons don't care how much capital you've raised.`,
      },
      {
        id: 'ol-seg-3',
        speaker: 'Brian Janous',
        role: 'guest',
        timestamp: '14:55',
        text: `In some regions the interconnection queue is now north of 2,000 days. Think about that. You can have the site, the financing, the GPUs sitting in a warehouse, and you are still years away from turning the thing on because you're waiting for a grid connection.`,
        highlight: {
          refId: 'm-ol-1',
          quote: `the interconnection queue is now north of 2,000 days`,
          label: '2,000-day queue',
        },
      },
      {
        id: 'ol-seg-4',
        speaker: 'Tracy Alloway',
        role: 'host',
        timestamp: '21:40',
        text: `And it's not just the connection — it's the actual equipment, right? I keep hearing that the humble transformer has become this incredible chokepoint.`,
      },
      {
        id: 'ol-seg-5',
        speaker: 'Brian Janous',
        role: 'guest',
        timestamp: '27:10',
        text: `Exactly. This problem spans an absurd range. On one end you've got people only half-joking about putting data centers in space to get the power and cooling for free. And on the other end, the thing actually holding up a project is something as mundane as the choice of UPS and the backup-power topology, or a large transformer with a three-year lead time built in one of two factories on earth.`,
        highlight: {
          refId: 'm-ol-2',
          quote: `data centers in space`,
          label: 'The full range of the problem',
        },
      },
      {
        id: 'ol-seg-6',
        speaker: 'Brian Janous',
        role: 'guest',
        timestamp: '34:02',
        text: `So if you believe power is the constraint, the trade is almost boring. It's the utilities. It's the independent power producers. It's whoever is sitting on a permitted site with firm baseload and an interconnection agreement already signed. That's the beachfront property of the AI era.`,
        highlight: {
          refId: 'm-ol-3',
          quote: `whoever is sitting on a permitted site with firm baseload`,
          label: 'Utilities are the surprise trade',
        },
      },
    ],
  },

  // ── 4. All-In — analysed, summary only ─────────────────────────────────────
  {
    id: 'ep-allin-e184',
    podcastId: 'allin',
    title: 'E184: Rate Cuts, AI Capex, and the IPO Window Reopens',
    publishedAt: '2026-06-01',
    durationSec: 4920,
    status: 'ready',
    signal: 'normal',
    blurb: `The besties debate whether AI capex is a bubble or a supercycle, what reopening IPO markets mean for venture, and the politics of the week.`,
    entities: {
      people: ['Chamath Palihapitiya', 'David Sacks', 'David Friedberg', 'Jason Calacanis'],
      companies: ['Nvidia', 'OpenAI', 'Stripe', 'Databricks'],
      themes: ['AI capex', 'IPO window', 'Interest rates', 'Venture returns'],
    },
    summary: {
      synthesis: [
        `The panel splits on the central question of the moment: **is hyperscaler AI capex a rational supercycle or a late-stage bubble?** The bull case leans on real revenue and the power-constraint thesis; the bear case points to **circular financing** and depreciation schedules that may be wildly optimistic.`,
        `There's consensus on one thing: **a reopening IPO window changes venture math**. Several late-stage names finally have a clearing price, which pulls forward distributions and resets the bar for what stays private. The group debates whether this is healthy price discovery or a liquidity-driven head-fake.`,
      ],
      takeaways: [
        { title: 'AI capex: supercycle vs. bubble', detail: `The disagreement hinges on depreciation. If GPUs are 6-year assets, the math works; if they're 3-year assets, much of the reported margin is fiction.` },
        { title: 'The IPO window is genuinely open', detail: `A handful of clean listings reset comps and pull venture distributions forward for the first time in two years.` },
        { title: 'Circular financing is the risk to watch', detail: `When the chip vendor funds the cloud that buys the chips, reported demand can flatter the real end-market.` },
      ],
      qa: [
        { q: `Is this a bubble?`, a: `Sacks says no — the revenue is real and power-constrained. Friedberg is more cautious, flagging depreciation and vendor financing as the tells to watch.` },
        { q: `What reopens for founders?`, a: `Late-stage secondary and a credible IPO path, which changes how long you'd rationally stay private.` },
      ],
      moments: [
        { id: 'm-al-1', title: 'The depreciation argument', timestamp: '22:15', whyItMatters: `The single accounting assumption that decides whether AI infra margins are real — worth understanding before you have a view.` },
        { id: 'm-al-2', title: 'Circular financing tell', timestamp: '49:30', whyItMatters: `A concrete red flag for distinguishing real end-demand from vendor-funded demand.` },
      ],
    },
  },

  // ── 5. The AI Daily Brief — mid-pipeline ───────────────────────────────────
  {
    id: 'ep-aidaily-agents',
    podcastId: 'aidaily',
    title: 'Agents Go Mainstream: The Enterprise Tipping Point',
    publishedAt: '2026-06-05',
    durationSec: 1320,
    status: 'summarizing',
    signal: 'normal',
    blurb: `Why 2026 is the year agentic workflows cross from demo to deployment — and the governance problem nobody has solved yet.`,
    entities: {
      people: ['Nathaniel Whittemore'],
      companies: ['Anthropic', 'OpenAI', 'Salesforce'],
      themes: ['AI agents', 'Enterprise adoption', 'Governance'],
    },
    summary: {
      synthesis: [
        `The brief's thesis is that 2026 is the year **agentic workflows cross from demo to deployment**. The unlock isn't a smarter model — it's the surrounding scaffolding: tool use, memory, and evaluation harnesses that make an agent reliable enough to hand a real task. **Reliability, not capability, is the gate.**`,
        `The unsolved problem is **governance**. Once an agent can take actions — move money, email customers, change records — enterprises need permissions, audit trails, and a human-in-the-loop story before they grant write access. Whoever ships the trust layer captures the deployment, not just the demo.`,
      ],
      takeaways: [
        { title: 'Reliability is the real unlock', detail: `Capability is sufficient; the bottleneck is making agents dependable enough to trust with a real workflow.` },
        { title: 'Write access needs a trust layer', detail: `Permissions, audit logs, and human checkpoints are the prerequisites for agents that take consequential actions.` },
        { title: 'Distribution favors incumbents', detail: `Salesforce and peers can drop agents onto existing data and permissions — a cold-start advantage pure-play agents lack.` },
      ],
      qa: [
        { q: `What's actually blocking enterprise agent rollouts?`, a: `Not model quality — it's governance: who approved the action, what it touched, and how to roll it back. Until that's legible, agents stay read-only.` },
        { q: `Is an "agent" a feature or a company?`, a: `Whittemore's take: the durable businesses own the trust-and-permissions layer, not the agent loop itself, which is commoditizing fast.` },
      ],
      moments: [
        { id: 'm-ad-1', title: 'Reliability, not capability, is the gate', timestamp: '12:40', whyItMatters: `Reframes the agent race away from benchmarks toward the unglamorous engineering that actually ships deployments.` },
        { id: 'm-ad-2', title: 'The governance gap nobody has closed', timestamp: '18:05', whyItMatters: `Names the specific blocker — write-access accountability — that decides which vendors win enterprise budgets.` },
      ],
    },
  },

  // ── 6. Acquired — analysed, summary only ───────────────────────────────────
  {
    id: 'ep-acquired-tsmc',
    podcastId: 'acquired',
    title: 'TSMC: The Most Important Company in the World',
    publishedAt: '2026-05-30',
    durationSec: 13200,
    status: 'ready',
    signal: 'normal',
    blurb: `How a Taiwanese foundry became the single most strategically important company on earth — and the concentration risk that creates.`,
    entities: {
      people: ['Morris Chang', 'Ben Gilbert', 'David Rosenthal'],
      companies: ['TSMC', 'Apple', 'Nvidia', 'ASML'],
      themes: ['Semiconductors', 'Foundry model', 'Geopolitics', 'Concentration risk'],
    },
    summary: {
      synthesis: [
        `Ben and David trace how Morris Chang's **pure-play foundry model inverted the chip industry**: by never designing its own chips, TSMC became the trusted manufacturing partner for everyone, accumulating a process lead that now compounds. The episode frames **TSMC as the keystone of the entire AI economy**.`,
        `The strategic punchline is **concentration risk**. A single company, on a single island, in a single geopolitical flashpoint, fabricates the overwhelming majority of leading-edge chips. The CHIPS-Act-era reshoring is real but slow, and the hosts are skeptical it meaningfully de-risks the next decade.`,
      ],
      takeaways: [
        { title: 'The foundry model was the masterstroke', detail: `By not competing with its customers, TSMC earned the trust to manufacture for all of them — and the volume to out-invest everyone.` },
        { title: 'Process leadership compounds', detail: `Each node lead funds the next, creating a flywheel competitors can't easily enter.` },
        { title: 'Concentration is the systemic risk', detail: `Leading-edge capacity is geographically concentrated in a way that has no quick fix.` },
      ],
      qa: [
        { q: `Can Intel or Samsung catch up?`, a: `The hosts are doubtful on leading-edge in the near term — the capital and yield-learning gap is enormous and self-reinforcing.` },
        { q: `Does reshoring fix the risk?`, a: `Partially and slowly. New fabs help at trailing edge but don't replicate the ecosystem or the talent density quickly.` },
      ],
      moments: [
        { id: 'm-aq-1', title: 'The "trust" insight behind the foundry model', timestamp: '1:12:30', whyItMatters: `Explains why a manufacturing choice became an unbreachable strategic moat.` },
      ],
    },
  },

  // ── 7. In Good Company — transcribing ──────────────────────────────────────
  {
    id: 'ep-igc-tangen',
    podcastId: 'ingoodcompany',
    title: 'Owning 1.5% of the World: Lessons from the Oil Fund',
    publishedAt: '2026-06-05',
    durationSec: 3000,
    status: 'transcribing',
    signal: 'normal',
    blurb: `How the world's largest sovereign wealth fund thinks about ownership, voting, and the very long term.`,
    entities: {
      people: ['Nicolai Tangen'],
      companies: ['Norges Bank Investment Management'],
      themes: ['Sovereign wealth', 'Long-term ownership', 'Governance'],
    },
    summary: {
      synthesis: [
        `Tangen frames the fund's edge as **structural patience**: owning roughly 1.5% of every listed company means you cannot trade your way out, so the only real lever is being a thoughtful long-term owner. Permanence changes the question from "will this pop" to **"will this compound for decades."**`,
        `Most of the conversation is about **active ownership through voting and engagement** rather than stock-picking. At that scale you can't beat the index by trading; you improve returns by improving governance across the companies you already own — board quality, executive pay, and long-horizon capital allocation.`,
      ],
      takeaways: [
        { title: 'Scale converts trading into ownership', detail: `Owning a slice of everything removes the exit option, so value comes from stewardship, not timing.` },
        { title: 'Governance is the return lever', detail: `Voting, engagement, and pay discipline move the needle more than security selection at index scale.` },
        { title: 'Patience is the moat', detail: `A mandate measured in decades lets the fund hold through drawdowns that force others to sell.` },
      ],
      qa: [
        { q: `How do you add value if you basically own the index?`, a: `By being an active owner — voting thoughtfully, pushing on board quality and pay, setting long-term expectations — not by trading in and out.` },
        { q: `What's the hardest part of the job?`, a: `Tangen points to temperament and communication: staying calm through volatility and explaining a 30-year mandate to a public that judges quarterly.` },
      ],
      moments: [
        { id: 'm-gc-1', title: 'Why permanence changes the question', timestamp: '22:10', whyItMatters: `A clean articulation of how an unsellable position reshapes every decision toward the long term.` },
        { id: 'm-gc-2', title: 'Engagement beats stock-picking at scale', timestamp: '36:48', whyItMatters: `A useful mental model for any large, diversified owner thinking about where returns actually come from.` },
      ],
    },
  },

  // ── 8. Cheeky Pint — fetching ──────────────────────────────────────────────
  {
    id: 'ep-cheeky-collison',
    podcastId: 'cheekypint',
    title: 'John Collison on Latency, Developer Joy, and Compounding APIs',
    publishedAt: '2026-06-05',
    durationSec: 3600,
    status: 'fetching',
    signal: 'normal',
    blurb: `Why a few hundred milliseconds decides who wins in payments, and how developer experience compounds into a moat.`,
    entities: {
      people: ['John Collison'],
      companies: ['Stripe'],
      themes: ['Developer experience', 'Payments', 'API design'],
    },
    summary: {
      synthesis: [
        `Collison's core claim is that in payments **a few hundred milliseconds is a competitive weapon**: latency shows up directly in authorization rates and checkout conversion, so shaving it compounds into real revenue for every business on the platform. Performance isn't a vanity metric — it's the product.`,
        `The deeper theme is that **developer experience compounds into a moat**. Clean APIs, great docs, and the small daily delights — "developer joy" — lower integration cost, which drives adoption, which funds more polish. It's a flywheel competitors struggle to copy because it's **a thousand small decisions, not one feature.**`,
      ],
      takeaways: [
        { title: 'Latency is a revenue feature', detail: `In payments, milliseconds move authorization and conversion rates — speed is a direct line to customers' top line.` },
        { title: 'Developer joy is strategy', detail: `Docs, ergonomics, and polish lower integration cost and compound into adoption that's hard to dislodge.` },
        { title: 'Good APIs compound', detail: `Each well-designed primitive makes the next integration easier, widening the moat over time.` },
      ],
      qa: [
        { q: `Why obsess over a few hundred milliseconds?`, a: `Because latency is measurable in authorization rates and checkout conversion — it's not polish, it's money for every business on Stripe.` },
        { q: `Is developer experience really defensible?`, a: `Collison argues yes: it's a thousand small decisions and sustained investment, far harder to clone than a single headline feature.` },
      ],
      moments: [
        { id: 'm-cp-1', title: 'Milliseconds as a competitive weapon', timestamp: '14:25', whyItMatters: `Connects an engineering metric straight to customer revenue — a reframing any infrastructure company can borrow.` },
        { id: 'm-cp-2', title: 'Why developer joy compounds', timestamp: '29:50', whyItMatters: `Explains how DX becomes a moat rather than a nicety, via a compounding adoption flywheel.` },
      ],
    },
  },

  // ── 9. All-In (older) — ready, for archive depth ───────────────────────────
  {
    id: 'ep-allin-e183',
    podcastId: 'allin',
    title: 'E183: The Energy Trade, Robotics, and Founder Mode',
    publishedAt: '2026-05-24',
    durationSec: 5100,
    status: 'ready',
    signal: 'normal',
    blurb: `Robotics finally has its moment, the energy trade goes mainstream, and a debate on "founder mode" vs. professional management.`,
    entities: {
      people: ['Chamath Palihapitiya', 'David Sacks', 'David Friedberg', 'Jason Calacanis'],
      companies: ['Tesla', 'Figure', 'Vistra'],
      themes: ['Robotics', 'Energy', 'Management', 'Founder mode'],
    },
    summary: {
      synthesis: [
        `The group argues **humanoid robotics has crossed from science project to investable thesis**, driven by the same model advances powering language AI. The debate is on timelines and unit economics, not direction.`,
        `A recurring thread ties back to energy: **robots, like data centers, are ultimately a power story**. The "energy trade" is becoming the panel's most consensus position, which itself raises the contrarian question of whether it's now crowded.`,
      ],
      takeaways: [
        { title: 'Robotics is now investable', detail: `Foundation-model progress transfers to manipulation and planning, pulling humanoid timelines forward.` },
        { title: 'Everything routes back to energy', detail: `Compute and robots are both demand on the grid — the energy trade is the meta-trade.` },
      ],
      qa: [
        { q: `Is the energy trade crowded?`, a: `Possibly — the panel notes that when a trade becomes a consensus on a popular podcast, the easy money is usually already made.` },
      ],
      moments: [
        { id: 'm-al3-1', title: 'Founder mode vs. professional management', timestamp: '1:05:20', whyItMatters: `A sharp, quotable framing of a debate every scaling company eventually has.` },
      ],
    },
  },

  // ── 10. BG2 — failed (retry demo) ──────────────────────────────────────────
  {
    id: 'ep-bg2-saas',
    podcastId: 'bg2',
    title: 'The SaaS Correction and AI Sovereignty',
    publishedAt: '2026-05-28',
    durationSec: 3252,
    status: 'failed',
    signal: 'normal',
    blurb: `Why seat-based SaaS multiples are compressing and what "AI sovereignty" means for nations and clouds.`,
    entities: {
      people: ['Brad Gerstner', 'Bill Gurley'],
      companies: ['Salesforce', 'Microsoft'],
      themes: ['SaaS', 'AI sovereignty', 'Valuation'],
    },
  },
]

export const WEEKLY: WeeklySummary = {
  id: 'wk-2026-05-30',
  rangeLabel: 'May 30 – June 5, 2026',
  episodeCount: 9,
  readMinutes: 11,
  overview: [
    `The throughline across the week was unmistakable: the AI debate has moved from "which model wins" to "what physically constrains the buildout." Stratechery reframed models as a commoditizing cost center while distribution stays scarce; Odd Lots put hard numbers on the real bottleneck — power, interconnection queues, and transformer lead times; and All-In turned both threads into a markets question about whether AI capex is a supercycle or a bubble.`,
    `On the investing side, Invest Like the Best and In Good Company circled the same idea from opposite ends of the size spectrum: durable returns come from owning the right thing for a very long time and staying liquid when others are forced to sell. Acquired's TSMC deep-dive supplied the concrete case study — process leadership that compounds, wrapped in geopolitical concentration risk.`,
    `If there's one synthesis: the market is repricing the un-sexy layer of the stack — power, foundries, distribution — and discounting the layer everyone was excited about a year ago, the models themselves.`,
  ],
  topThemes: [
    { label: 'Power & the grid', momentum: 64 },
    { label: 'AI capex: bubble or cycle', momentum: 41 },
    { label: 'Distribution > models', momentum: 33 },
    { label: 'Permanent capital', momentum: 18 },
    { label: 'Semiconductors', momentum: 12 },
  ],
  interesting: {
    quote: `Forget the chips — you cannot pay your way to the front of an interconnection queue. The electrons don't care how much capital you've raised.`,
    speaker: 'Brian Janous',
    role: 'on Odd Lots',
    episodeId: 'ep-oddlots-grid',
  },
  takeaways: [
    { title: 'Power is the real AI constraint', detail: `Multiple shows converged on electricity, not silicon, as the binding limit on the buildout — with 2,000-day interconnection queues as the headline number.` },
    { title: 'Models are commoditizing', detail: `The week's contrarian-but-spreading view: durable value accrues to whoever owns distribution, not whoever owns the frontier model.` },
    { title: 'The IPO window cracked open', detail: `Reopening public markets reset venture math and pulled distributions forward for the first time in two years.` },
    { title: 'Concentration risk is structural', detail: `TSMC's dominance is a single-point-of-failure for the entire AI economy that reshoring won't fix quickly.` },
  ],
  contradictions: [
    `All-In's panel split hard on whether AI capex is a rational supercycle (Sacks) or a depreciation-driven bubble (Friedberg) — same data, opposite conclusions.`,
    `Stratechery says owning the model is a weak position; the AI Daily Brief framed frontier-model ownership as the enterprise kingmaker. Worth holding both.`,
  ],
  mentions: {
    people: ['Sam Altman', 'Morris Chang', 'Brian Janous', 'Satya Nadella', 'Nicolai Tangen'],
    companies: ['Nvidia', 'TSMC', 'Microsoft', 'OpenAI', 'Constellation Energy', 'Stripe'],
  },
  questions: [
    `If power is the constraint, which permitted-site / interconnection owners are mispriced today?`,
    `What depreciation schedule are hyperscalers actually using for GPUs — and what happens to margins if it's too aggressive?`,
    `Is "distribution beats models" already priced into the incumbents, or is there still a trade?`,
  ],
  sourceEpisodeIds: [
    'ep-oddlots-grid',
    'ep-stratechery-agg',
    'ep-allin-e184',
    'ep-iltb-compounders',
    'ep-acquired-tsmc',
  ],
}
