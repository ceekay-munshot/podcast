// ─────────────────────────────────────────────────────────────────────────────
// Transcription — a provider chain, tried in order, first hit wins:
//
//   1. feed transcript  — free, instant, accurate (publisher's own SRT/VTT)
//   2. paid Whisper     — PRIMARY once a key is supplied   (seam below)
//   3. free-tier Whisper— BACKUP (Groq / Cloudflare Workers AI)  (seam below)
//
// Runtime-agnostic (Vite dev middleware + Cloudflare Pages Function). Returns
// null when no provider can produce a transcript → caller falls back to show-notes.
// ─────────────────────────────────────────────────────────────────────────────

export interface TranscribeInput {
  title?: string
  transcriptUrl?: string // publisher SRT/VTT from the feed
  audioUrl?: string // episode audio, for Whisper
}

export interface TranscribeConfig {
  // Whisper providers slot in here later (kept as a seam so the chain is ready):
  whisperKey?: string // paid primary (e.g. OpenAI Whisper / Deepgram / AssemblyAI)
  groqKey?: string // free-tier backup
  workersAi?: unknown // Cloudflare Workers AI binding (free-tier backup, on-stack)
}

export interface TranscriptResult {
  text: string
  source: 'feed' | 'whisper-primary' | 'whisper-backup'
}

// Strip SRT/VTT cue numbers, timestamps, and tags down to plain spoken text.
export function captionsToText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => {
      const l = line.trim()
      if (!l) return false
      if (/^WEBVTT/i.test(l)) return false
      if (/^NOTE\b/i.test(l)) return false
      if (/^\d+$/.test(l)) return false // cue index
      if (l.includes('-->')) return false // timestamp line
      return true
    })
    .map((l) => l.replace(/<[^>]+>/g, '').trim()) // strip inline tags (e.g. <c>, <v Speaker>)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchCaptions(url: string, maxBytes = 1_500_000, timeoutMs = 12_000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'MunshotPodcasts/1.0' } })
    if (!res.ok || !res.body) return ''
    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let text = ''
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (received >= maxBytes) {
        await reader.cancel().catch(() => {})
        break
      }
    }
    return text
  } catch {
    return ''
  } finally {
    clearTimeout(timer)
  }
}

export async function transcribeEpisode(input: TranscribeInput, _config: TranscribeConfig = {}): Promise<TranscriptResult | null> {
  // 1) FREE: publisher-provided transcript in the feed (Odd Lots, Acquired, …)
  if (input.transcriptUrl) {
    const text = captionsToText(await fetchCaptions(input.transcriptUrl))
    if (text.length > 200) return { text, source: 'feed' }
  }

  // 2) PRIMARY (seam): paid Whisper on input.audioUrl when `_config.whisperKey` is set.
  //    Download/stream the audio → transcription API → return { text, source: 'whisper-primary' }.
  //    Needs the async/queue path for long episodes — wired in the next step.

  // 3) BACKUP (seam): free-tier Whisper (Groq `_config.groqKey` or Workers AI `_config.workersAi`),
  //    rate-limited. Same audio path; returns { text, source: 'whisper-backup' }.

  return null
}
