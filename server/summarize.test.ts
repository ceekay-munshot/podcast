import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { summarizeEpisode } from './summarize'
import { sharedSummaryKey, type SummaryStore } from './summaryStore'
import type { SummarizeResult } from './summarize'

// The point of the shared store: process an episode ONCE, reuse it for everyone.
// These tests pin that contract — a stored episode is served with no LLM call, a
// fresh one is processed and persisted, and the weekly roundup (no id) is never
// shared. The LLM is mocked, so a `fetch` call === a real (paid) summarization.

// A valid OpenAI forced-function-call response carrying a minimal summary.
function okLLM() {
  const args = JSON.stringify({
    synthesis: ['point'],
    qa: [{ q: 'Q', a: 'A' }],
    highlights: [{ title: 'H', timestamp: '—', detail: 'why', key: true }],
    tone: { overall: 'neutral', rationale: 'r', aspects: [{ subject: 'S', sentiment: 'neutral', note: 'n' }] },
  })
  return { ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: args } }] } }] }) }
}

// An in-memory SummaryStore spy standing in for KV / the filesystem.
function memStore() {
  const map = new Map<string, SummarizeResult>()
  const store: SummaryStore & { map: Map<string, SummarizeResult> } = {
    map,
    get: vi.fn(async (k: string) => map.get(k) ?? null),
    put: vi.fn(async (k: string, v: SummarizeResult) => void map.set(k, v)),
  }
  return store
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('summarizeEpisode — shared store reuse', () => {
  it('serves a stored episode without any LLM call (L1-cold path)', async () => {
    const store = memStore()
    const stored: SummarizeResult = { summary: { synthesis: ['cached'], highlights: [], qa: [] }, transcript: [] }
    // A fresh id never seen by the in-process L1 cache → only the shared store can serve it.
    store.map.set(sharedSummaryKey('live-allin-stored'), stored)

    const result = await summarizeEpisode(
      { id: 'live-allin-stored', title: 'Stored Episode', show: 'All-In', notes: 'some notes' },
      { openaiKey: 'sk-test', store },
    )

    expect(result).toEqual(stored)
    expect(fetchMock).not.toHaveBeenCalled() // no transcription, no LLM — pure reuse
  })

  it('processes a fresh episode once and persists it for the next user', async () => {
    const store = memStore()
    fetchMock.mockResolvedValueOnce(okLLM())

    const result = await summarizeEpisode(
      { id: 'live-allin-fresh', title: 'Fresh Episode', show: 'All-In', notes: 'some notes' },
      { openaiKey: 'sk-test', store },
    )

    expect(fetchMock).toHaveBeenCalledTimes(1) // exactly one (paid) LLM call
    expect(store.put).toHaveBeenCalledTimes(1)
    expect(store.map.get(sharedSummaryKey('live-allin-fresh'))).toEqual(result) // reusable hereafter
  })

  it('does not touch the store when no episode id is supplied (weekly roundup)', async () => {
    const store = memStore()
    fetchMock.mockResolvedValueOnce(okLLM())

    await summarizeEpisode(
      { title: 'Munshot Weekly Roundup — unique', show: 'Munshot Weekly', notes: 'cross-episode notes' },
      { openaiKey: 'sk-test', store },
    )

    expect(store.get).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
  })
})

describe('summarizeEpisode — ideas extraction', () => {
  it('passes through valid pitched ideas and drops malformed ones', async () => {
    const args = JSON.stringify({
      synthesis: ['point'],
      qa: [],
      ideas: [
        { idea: 'Long NVDA', proponent: 'Sacks', thesis: ['power constrained', 'real demand'], kind: 'stock' },
        { idea: '', proponent: 'Nobody', thesis: ['orphaned'] }, // dropped: no headline
        { idea: 'Buy gold', proponent: '  ', thesis: 'not-an-array', kind: 'bogus' }, // proponent→"—", thesis→[], kind dropped
      ],
      highlights: [],
      tone: { overall: 'neutral', rationale: 'r', aspects: [] },
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: args } }] } }] }),
    })

    const { summary } = await summarizeEpisode(
      { id: 'live-allin-ideas', title: 'Pitch Episode', show: 'All-In', notes: 'notes' },
      { openaiKey: 'sk-test', store: memStore() },
    )

    expect(summary.ideas).toEqual([
      { idea: 'Long NVDA', proponent: 'Sacks', thesis: ['power constrained', 'real demand'], kind: 'stock' },
      { idea: 'Buy gold', proponent: '—', thesis: [] },
    ])
  })

  it('omits the ideas field entirely when nothing is pitched', async () => {
    fetchMock.mockResolvedValueOnce(okLLM()) // okLLM() carries no ideas
    const { summary } = await summarizeEpisode(
      { id: 'live-allin-noideas', title: 'No Pitch', show: 'All-In', notes: 'notes' },
      { openaiKey: 'sk-test', store: memStore() },
    )
    expect(summary.ideas).toBeUndefined()
  })
})
