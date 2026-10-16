// Shared by the small Pages gateway and the Node Actions runner. No Node imports.
export const STATE_BRANCH = 'codex/podcast-state'
export const QUEUE_PREFIX = 'codex/podcast-queue/'
export const REPOSITORY = 'ceekay-munshot/podcast'
export interface QueuedRequest { id: string; method: string; path: string; user: string | null; body: string; contentType: string; createdAt: number }
export interface PreparedResponse { status: number; headers: Record<string, string>; body: string; preparedAt: number; user: string | null }
const encoder = new TextEncoder()
export function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
export function unbase64(text: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(text), c => c.charCodeAt(0)) }
async function aes(secret: string) {
  const key = unbase64(secret)
  if (key.length !== 32) throw new Error('An encryption key must contain 32 random bytes')
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(secret), encoder.encode(JSON.stringify(value)))
  return JSON.stringify({ v: 1, iv: base64(iv), data: base64(new Uint8Array(ciphertext)) })
}
export async function open<T>(text: string, secret: string): Promise<T> {
  const record = JSON.parse(text)
  if (record.v !== 1) throw new Error('Unsupported encrypted record')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(record.iv) }, await aes(secret), unbase64(record.data))
  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}
export async function opaqueName(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', unbase64(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), b => b.toString(16).padStart(2, '0')).join('')
}
export function viewIdentity(method: string, path: string, user: string | null): string { return JSON.stringify([method, path, user]) }
export class GitHub {
  constructor(private token: string, private fetcher: typeof fetch = fetch) {}
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
        method, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'TybournePodcast', 'x-github-api-version': '2022-11-28' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
      })
      if (response.ok) return response.status === 204 ? undefined as T : await response.json() as T
      const problem = await response.json().catch(() => null) as { message?: string } | null
      const limited = response.status === 429 || (response.status === 403 && /rate limit/i.test(problem?.message || ''))
      // Retry only an explicit rate-limit rejection, never an unknown write outcome.
      const delay = Number(response.headers.get('retry-after') || 60)
      if (limited && attempt < 3 && delay <= 120) { await new Promise(resolve => setTimeout(resolve, Math.max(1, delay) * 1000)); continue }
      throw new GitHubError(response.status)
    }
  }
  async head(branch = STATE_BRANCH): Promise<string | null> {
    try { return (await this.request<{ object: { sha: string } }>(`git/ref/heads/${branch}`)).object.sha }
    catch (error) { if (error instanceof GitHubError && error.status === 404) return null; throw error }
  }
  async file(path: string, ref: string): Promise<string | null> {
    // Encrypted data in this public repo is safe to retrieve without auth from
    // an immutable commit URL. This avoids consuming REST quotas per summary.
    const raw = await this.fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/${ref}/${path}`, { signal: AbortSignal.timeout(30_000) })
    if (raw.ok) return raw.text()
    if (raw.status !== 404) throw new GitHubError(raw.status)
    // Newly published Git commits can reach the raw CDN slightly later.
    try {
      const row = await this.request<{ content?: string; sha: string }>(`contents/${path}?ref=${encodeURIComponent(ref)}`)
      const content = row.content || (await this.request<{ content: string }>(`git/blobs/${row.sha}`)).content
      return new TextDecoder().decode(unbase64(content.replace(/\s/g, '')))
    } catch (error) { if (error instanceof GitHubError && error.status === 404) return null; throw error }
  }
  async commit(files: Record<string, string>, parent: string | null, message: string): Promise<string> {
    const base = parent ? (await this.request<{ tree: { sha: string } }>(`git/commits/${parent}`)).tree.sha : undefined
    let tree = { sha: base }
    let batch: { path: string; mode: string; type: string; content: string }[] = [], size = 0
    const flush = async () => {
      tree = await this.request<{ sha: string }>('git/trees', 'POST', { ...(tree.sha ? { base_tree: tree.sha } : {}), tree: batch })
      batch = []; size = 0
    }
    for (const [path, content] of Object.entries(files)) {
      if (size && size + content.length > 2_000_000) await flush()
      batch.push({ path, mode: '100644', type: 'blob', content }); size += content.length
    }
    if (batch.length) await flush()
    return (await this.request<{ sha: string }>('git/commits', 'POST', { tree: tree.sha, parents: parent ? [parent] : [], message })).sha
  }
  async commitReceipt(path: string, content: string, previous: string | null): Promise<string> {
    const bytes = encoder.encode(content)
    let sha: string | undefined
    if (previous !== null) {
      const old = encoder.encode(previous), prefix = encoder.encode(`blob ${old.length}\0`)
      const blob = new Uint8Array(prefix.length + old.length); blob.set(prefix); blob.set(old, prefix.length)
      sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', blob)), b => b.toString(16).padStart(2, '0')).join('')
    }
    const result = await this.request<{ commit: { sha: string } }>(`contents/${path}`, 'PUT', { branch: STATE_BRANCH, message: 'Save encrypted delivery receipt', content: base64(bytes), ...(sha ? { sha } : {}) })
    return result.commit.sha
  }
  async publish(branch: string, sha: string, exists: boolean): Promise<void> {
    await this.request(exists ? `git/refs/heads/${branch}` : 'git/refs', exists ? 'PATCH' : 'POST', exists ? { sha, force: false } : { ref: `refs/heads/${branch}`, sha })
  }
}
export class GitHubError extends Error { constructor(public status: number) { super(`GitHub request failed (${status})`) } }
