import type { KVNamespace } from '../summaryStore'
import { GitHub, STATE_BRANCH, base64, open, opaqueName, seal, unbase64, type PreparedResponse } from './protocol'

export interface ArchivedRecord { name: string; value: string; expiration?: number; metadata?: unknown; sha256?: string }
interface Index { version: 1; entries: Record<string, string>; importedAt?: string }
// All historical records remain in Git history, including expired KV values.
// Expiration affects reads, never preservation of the imported archive.
export class GitHubState implements KVNamespace {
  private index: Index = { version: 1, entries: {} }
  private rows = new Map<string, ArchivedRecord>()
  private ciphertext = new Map<string, string | null>()
  private dirty = new Map<string, ArchivedRecord>()
  private extra = new Map<string, string>()
  private tail: Promise<unknown> = Promise.resolve()
  private head: string | null = null
  private indexDirty = false
  failed = false
  constructor(private github: GitHub, private secret: string, private gatewaySecret: string, private now = () => Date.now()) {}
  async load(): Promise<boolean> {
    this.head = await this.github.head()
    if (!this.head) return false
    const value = await this.github.file('index.enc', this.head)
    if (!value) throw new Error('State index is missing; refusing to initialize an empty replacement')
    this.index = await open<Index>(value, this.secret)
    if (this.index.version !== 1) throw new Error('Invalid state index')
    return true
  }
  names(): string[] { return Object.keys(this.index.entries) }
  async record(name: string): Promise<ArchivedRecord | null> {
    const cached = this.rows.get(name)
    if (cached) return cached
    const journal = /^(delivery|request):v1:/.test(name)
    const path = this.index.entries[name] || (journal ? `records/${await opaqueName(name, this.secret)}.enc` : null)
    if (!path || !this.head) return null
    const value = await this.github.file(path, this.head)
    this.ciphertext.set(path, value)
    if (!value) { if (journal) return null; throw new Error('Archived record is missing') }
    const row = await open<ArchivedRecord>(value, this.secret)
    if (row.name !== name) throw new Error('Archived record key mismatch')
    this.rows.set(name, row)
    return row
  }
  async get(name: string): Promise<string | null>
  async get(name: string, type: 'json'): Promise<unknown>
  async get(name: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  async get(name: string, type?: 'json' | 'arrayBuffer'): Promise<unknown> {
    const row = await this.record(name)
    if (!row || (row.expiration && row.expiration * 1000 <= this.now())) return null
    const bytes = unbase64(row.value)
    if (type === 'arrayBuffer') return bytes.buffer as ArrayBuffer
    const text = new TextDecoder().decode(bytes)
    return type === 'json' ? JSON.parse(text) as unknown : text
  }
  async put(name: string, value: string | ArrayBuffer, options?: { expirationTtl?: number }): Promise<void> {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)
    const row: ArchivedRecord = { name, value: base64(bytes), ...(options?.expirationTtl ? { expiration: Math.floor(this.now() / 1000) + options.expirationTtl } : {}) }
    this.rows.set(name, row); this.dirty.set(name, row)
    if (!this.index.entries[name] && !/^(delivery|request):v1:/.test(name)) {
      this.index.entries[name] = `records/${await opaqueName(name, this.secret)}.enc`; this.indexDirty = true
    }
  }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = this.names().filter(name => name.startsWith(options.prefix || '')).sort()
    const start = Number(options.cursor || 0), end = start + (options.limit || 1000)
    return { keys: names.slice(start, end).map(name => ({ name })), list_complete: end >= names.length, cursor: end >= names.length ? undefined : String(end) }
  }
  async import(records: ArchivedRecord[], importedAt: string) {
    if (this.head || this.names().length) throw new Error('Import refuses to overwrite existing GitHub state')
    for (const row of records) {
      this.rows.set(row.name, row); this.dirty.set(row.name, row)
      this.index.entries[row.name] = `records/${await opaqueName(row.name, this.secret)}.enc`
    }
    this.index.importedAt = importedAt
    this.indexDirty = true
  }
  async prepared(path: string, response: PreparedResponse) { this.extra.set(path, await seal(response, this.gatewaySecret)) }
  async preparedRecord(path: string): Promise<PreparedResponse | null> {
    const text = this.extra.get(path) || (this.head ? await this.github.file(path, this.head) : null)
    return text ? open<PreparedResponse>(text, this.gatewaySecret) : null
  }
  async checkpoint(): Promise<void> {
    const operation = this.tail.then(async () => {
      if (this.failed) throw new Error('Previous state publication failed; refusing further external side effects')
      const rows = new Map(this.dirty), extras = new Map(this.extra)
      if (!rows.size && !extras.size) return
      const indexSnapshot = JSON.stringify(this.index), writeIndex = this.indexDirty || !this.head
      const files: Record<string, string> = { ...Object.fromEntries(extras) }
      if (writeIndex) files['index.enc'] = await seal(JSON.parse(indexSnapshot), this.secret)
      for (const [name, row] of rows) files[this.index.entries[name] || `records/${await opaqueName(name, this.secret)}.enc`] = await seal(row, this.secret)
      const paths = Object.keys(files), receipt = rows.size === 1 && [...rows.keys()][0].startsWith('delivery:v1:')
      const only = paths[0]
      let sha: string
      if (receipt && this.head && paths.length === 1 && this.ciphertext.has(only)) {
        // One REST write per claim/receipt keeps long threads well within the
        // Actions token's API limits. The workflow is the only state writer.
        sha = await this.github.commitReceipt(only, files[only], this.ciphertext.get(only)!)
      } else {
        sha = await this.github.commit(files, this.head, 'Save encrypted podcast state')
        await this.github.publish(STATE_BRANCH, sha, !!this.head)
      }
      this.head = sha
      for (const [path, content] of Object.entries(files)) this.ciphertext.set(path, content)
      if (writeIndex && JSON.stringify(this.index) === indexSnapshot) this.indexDirty = false
      for (const [name, row] of rows) if (this.dirty.get(name) === row) this.dirty.delete(name)
      for (const [path, value] of extras) if (this.extra.get(path) === value) this.extra.delete(path)
    })
    this.tail = operation.catch(() => { this.failed = true })
    await operation
  }
}
