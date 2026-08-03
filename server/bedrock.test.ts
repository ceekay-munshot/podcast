import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_BEDROCK_REGION, viaBedrock } from './bedrock'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('viaBedrock', () => {
  it('posts a Converse request with forced tool use and a bearer token, and returns the raw tool input', async () => {
    const toolInput = { synthesis: ['point'], qa: [], highlights: [], tone: { overall: 'neutral', rationale: 'r', aspects: [] } }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ output: { message: { content: [{ toolUse: { name: 'emit_summary', input: toolInput } }] } } }),
    })

    const schema = { type: 'object' }
    const result = await viaBedrock({ system: 'sys', user: 'usr' }, 'bedrock-key', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', schema)

    expect(result).toEqual(toolInput) // same raw shape as viaOpenAI/viaAnthropic
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://bedrock-runtime.${DEFAULT_BEDROCK_REGION}.amazonaws.com/model/us.anthropic.claude-sonnet-4-5-20250929-v1%3A0/converse`)
    expect(init.headers.authorization).toBe('Bearer bedrock-key')
    const body = JSON.parse(init.body)
    expect(body.system).toEqual([{ text: 'sys' }])
    expect(body.messages).toEqual([{ role: 'user', content: [{ text: 'usr' }] }])
    expect(body.toolConfig.toolChoice).toEqual({ tool: { name: 'emit_summary' } })
    expect(body.toolConfig.tools[0].toolSpec.inputSchema.json).toEqual(schema)
  })

  it('honors a region override', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ output: { message: { content: [{ toolUse: { name: 'emit_summary', input: {} } }] } } }) })
    await viaBedrock({ system: 's', user: 'u' }, 'key', 'model-id', {}, 'eu-west-1')
    expect(fetchMock.mock.calls[0][0]).toContain('https://bedrock-runtime.eu-west-1.amazonaws.com/')
  })

  it('throws with the response body on a non-ok status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'access denied' })
    await expect(viaBedrock({ system: 's', user: 'u' }, 'key', 'model-id', {})).rejects.toThrow(/bedrock 403/)
  })

  it('throws when the response carries no emit_summary tool use', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ output: { message: { content: [] } } }) })
    await expect(viaBedrock({ system: 's', user: 'u' }, 'key', 'model-id', {})).rejects.toThrow(/no emit_summary tool use/)
  })
})
