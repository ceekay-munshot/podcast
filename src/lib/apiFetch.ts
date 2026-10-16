import { USER_HEADER } from './identityKey'

// ─────────────────────────────────────────────────────────────────────────────
// Identity-aware fetch for SAME-ORIGIN /api/* calls. Its own tiny module (not
// api.ts) so weeklyApi.ts can use it too without a circular import.
//
// Once AppData resolves the Munshot identity (src/lib/munshot.ts) it calls
// setApiUser with the CANONICAL user key (src/lib/identityKey.ts) — already
// header-safe, no encoding needed — and every subsequent /api/* request carries
// it, letting the server pick that user's KV keys. No identity → plain fetch →
// the server's legacy/global behavior, byte-identical to before.
//
// Cross-origin calls (e.g. the direct Apple Search path in api.ts) must NOT go
// through this wrapper: a custom header would trigger a CORS preflight Apple
// doesn't answer.
// ─────────────────────────────────────────────────────────────────────────────

let apiUser: string | null = null

/** Set by AppData when identity resolves or changes. null = anonymous. */
export function setApiUser(key: string | null): void {
  apiUser = key
}

/** fetch(), plus the Munshot user header when an identity is active. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (apiUser) headers.set(USER_HEADER, apiUser)
  if (init?.method && init.method !== 'GET') headers.set('x-podcast-request-id', crypto.randomUUID())
  let response = await fetch(input, { ...init, headers })
  const started = Date.now()
  while (response.status === 202) {
    const queued = await response.clone().json().catch(() => null) as { pending?: boolean; job?: string } | null
    if (!queued?.pending || !queued.job || !/^[a-f0-9]{64}$/.test(queued.job)) return response
    if (Date.now() - started > 15 * 60_000) throw new Error('This request is saved on GitHub and is still processing. Check back shortly.')
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
      const timer = setTimeout(() => { init?.signal?.removeEventListener('abort', aborted); resolve() }, 5000)
      if (init?.signal?.aborted) aborted()
      else init?.signal?.addEventListener('abort', aborted, { once: true })
    })
    response = await fetch(`/api/jobs/${queued.job}`, { headers, signal: init?.signal })
  }
  return response
}
