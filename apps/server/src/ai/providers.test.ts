import { afterEach, describe, expect, it, vi } from 'vitest'
import { AIProviderError } from './errors'
import { OllamaProvider, OpenAICompatibleProvider } from './providers'

const input = {
  messages: [
    { role: 'system' as const, content: 'Return JSON.' },
    { role: 'user' as const, content: 'Review this change.' },
  ],
  fallbackFile: 'src/example.ts',
  fallbackLine: 2,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('OpenAICompatibleProvider', () => {
  it('uses the OpenAI chat completions protocol', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'example-model-2026',
          choices: [{ message: { content: '{"summary":"ok"}' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenAICompatibleProvider({
      provider: 'openai-compatible',
      baseUrl: 'https://example.invalid/v1/',
      apiKey: 'test-only-key',
      model: 'example-model',
      timeoutMs: 100,
    })

    const result = await provider.complete(input)

    expect(result.model).toBe('example-model-2026')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.invalid/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-key' })
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'example-model',
      temperature: 0,
      response_format: { type: 'json_object' },
    })
  })

  it('requires an API key without exposing it in errors', () => {
    expect(
      () =>
        new OpenAICompatibleProvider({
          provider: 'openai-compatible',
          timeoutMs: 100,
        }),
    ).toThrowError(AIProviderError)
  })

  it('maps network failures to a structured error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket failed')))
    const provider = new OpenAICompatibleProvider({
      provider: 'openai-compatible',
      apiKey: 'test-only-key',
      timeoutMs: 100,
    })

    await expect(provider.complete(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_NETWORK_ERROR',
      status: 502,
    })
  })

  it('aborts timed out requests', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }),
    )
    const provider = new OpenAICompatibleProvider({
      provider: 'openai-compatible',
      apiKey: 'test-only-key',
      timeoutMs: 20,
    })

    const completion = expect(provider.complete(input)).rejects.toMatchObject({
      code: 'AI_PROVIDER_TIMEOUT',
      status: 504,
    })
    await vi.advanceTimersByTimeAsync(21)

    await completion
  })
})

describe('OllamaProvider', () => {
  it('uses the non-streaming Ollama chat protocol', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ model: 'example-local', message: { content: '{"summary":"ok"}' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OllamaProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434/',
      model: 'example-local',
      timeoutMs: 100,
    })

    await provider.complete(input)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'example-local',
      format: 'json',
      stream: false,
    })
  })
})
