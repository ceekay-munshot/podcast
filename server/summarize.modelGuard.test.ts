import { describe, it, expect, vi } from 'vitest'
import { redactSecrets, resolveProvider, safeModel } from './summarize'

// ─────────────────────────────────────────────────────────────────────────────
// Guards against the misconfiguration that took the weekly brief down for weeks:
// the SUMMARY_MODEL setting had been set to an OpenAI API key, so every call asked
// OpenAI for a model NAMED after the secret — a 404 on every episode, and the key
// transmitted to the provider (and echoed in its error). These pin both halves of
// the fix: never send a secret-shaped value as a model, and never let a secret
// reach a log/annotation even if something echoes one.
// ─────────────────────────────────────────────────────────────────────────────

describe('safeModel', () => {
  it('passes a real model id through unchanged', () => {
    expect(safeModel('gpt-4o-mini', 'fallback')).toBe('gpt-4o-mini')
    expect(safeModel('claude-opus-4-8', 'fallback')).toBe('claude-opus-4-8')
    expect(safeModel('o3-mini', 'fallback')).toBe('o3-mini')
  })

  it('falls back to the default when a secret key is mis-set as the model', () => {
    // The exact shape of the real incident: an sk-proj key in SUMMARY_MODEL.
    expect(safeModel('sk-proj-ABCdef123456789_this-is-a-key', 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(safeModel('sk-ant-api03-xxxxxxxxxxxx', 'claude-opus-4-8')).toBe('claude-opus-4-8')
  })

  it('falls back on empty/whitespace/oversized values, never crashing the call', () => {
    expect(safeModel(undefined, 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(safeModel('   ', 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(safeModel('a model with spaces', 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(safeModel('x'.repeat(120), 'gpt-4o-mini')).toBe('gpt-4o-mini')
  })

  it('warns at most once so a misconfiguration is visible but not spammed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    // Many bad calls in a row (module-level "warned once" latch may already be set
    // by earlier tests) — the point is it never logs PER call.
    for (let i = 0; i < 5; i++) safeModel('sk-proj-another-key-value-here', 'gpt-4o-mini')
    expect(log.mock.calls.length).toBeLessThanOrEqual(1)
    log.mockRestore()
  })
})

describe('redactSecrets', () => {
  it('redacts an OpenAI key echoed back in an error body', () => {
    const body = '{"error":{"message":"The model `sk-proj-L2eLzm4Q69mH9J9oeWgkBZ_notreal` does not exist"}}'
    const out = redactSecrets(body)
    expect(out).not.toContain('sk-proj-L2eLzm4Q')
    expect(out).toContain('sk-***redacted***')
  })

  it('redacts bearer tokens', () => {
    expect(redactSecrets('authorization: Bearer abcdef0123456789')).toContain('Bearer ***redacted***')
  })

  it('leaves ordinary text alone', () => {
    const msg = 'anthropic 429: rate limit exceeded, retry after 2s'
    expect(redactSecrets(msg)).toBe(msg)
  })
})

// Provider selection after the Bedrock standardisation: setting a Bedrock key alone
// routes to Claude-on-Bedrock (the paramemo/tybourne convention), with OpenAI /
// Anthropic as the fallback, and LLM_PROVIDER still able to force a specific one.
describe('resolveProvider', () => {
  it('uses Bedrock when a Bedrock key is set and nothing is forced', () => {
    expect(resolveProvider({ bedrockKey: 'k' })).toBe('bedrock')
  })
  it('prefers Bedrock over OpenAI/Anthropic when its key is present', () => {
    expect(resolveProvider({ bedrockKey: 'k', openaiKey: 'o', anthropicKey: 'a' })).toBe('bedrock')
  })
  it('falls back to OpenAI, then Anthropic, when no Bedrock key is set', () => {
    expect(resolveProvider({ openaiKey: 'o', anthropicKey: 'a' })).toBe('openai')
    expect(resolveProvider({ anthropicKey: 'a' })).toBe('anthropic')
    expect(resolveProvider({})).toBeNull()
  })
  it('honours an explicit LLM_PROVIDER override', () => {
    // force OpenAI even though a Bedrock key is present
    expect(resolveProvider({ llmProvider: 'openai', openaiKey: 'o', bedrockKey: 'k' })).toBe('openai')
    expect(resolveProvider({ llmProvider: 'anthropic', anthropicKey: 'a', bedrockKey: 'k' })).toBe('anthropic')
    // the legacy toggle still works
    expect(resolveProvider({ llmProvider: 'claude', bedrockKey: 'k' })).toBe('bedrock')
    // a forced provider with no matching key resolves to nothing, not a silent fallback
    expect(resolveProvider({ llmProvider: 'claude' })).toBeNull()
    expect(resolveProvider({ llmProvider: 'openai', bedrockKey: 'k' })).toBeNull()
  })
})
