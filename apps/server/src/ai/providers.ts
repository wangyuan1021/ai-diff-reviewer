import type { AIModelOutput, AIProviderConfig, AIProviderName } from '@ai-diff-reviewer/shared'
import { AIProviderError } from './errors'

export interface ProviderMessage {
  role: 'system' | 'user'
  content: string
}

export interface AICompletionInput {
  messages: ProviderMessage[]
  fallbackFile: string
  fallbackLine: number
}

export interface AICompletionResult {
  content: string
  model: string
}

export interface AIProvider {
  readonly name: AIProviderName
  readonly model: string
  complete(input: AICompletionInput): Promise<AICompletionResult>
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

async function requestJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const body = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      throw new AIProviderError(
        `AI Provider 请求失败（HTTP ${response.status}）。`,
        'AI_PROVIDER_REQUEST_FAILED',
        502,
        { providerStatus: response.status },
      )
    }
    return body
  } catch (error) {
    if (error instanceof AIProviderError) throw error
    if (controller.signal.aborted) {
      throw new AIProviderError(
        `AI Provider 在 ${timeoutMs}ms 内未响应。`,
        'AI_PROVIDER_TIMEOUT',
        504,
      )
    }
    throw new AIProviderError(
      '无法连接 AI Provider，请检查地址与服务状态。',
      'AI_PROVIDER_NETWORK_ERROR',
      502,
    )
  } finally {
    clearTimeout(timeout)
  }
}

export class MockProvider implements AIProvider {
  readonly name = 'mock' as const
  readonly model: string

  constructor(config: AIProviderConfig) {
    this.model = config.model || 'mock-reviewer-v1'
  }

  async complete(input: AICompletionInput): Promise<AICompletionResult> {
    const output: AIModelOutput = {
      summary: 'Mock Provider 已完成确定性结构化审查，建议核对变更行为并执行回归测试。',
      overallRisk: 'medium',
      confidence: 0.88,
      risks: [
        {
          severity: 'medium',
          category: 'correctness',
          title: '变更行需要补充行为验证',
          file: input.fallbackFile,
          line: input.fallbackLine,
          evidence: '该行位于本次 Diff 的优先审查分块中，Mock 模式将其作为演示证据。',
          impact: '若变更行为缺少针对性验证，边界输入可能产生非预期结果。',
          suggestion: '根据该行的实际职责补充成功、失败与边界场景测试。',
        },
      ],
      testSuggestions: ['覆盖受影响逻辑的成功、失败和边界场景。'],
      releaseChecklist: ['确认演示风险已经人工复核，并执行受影响模块回归测试。'],
    }
    return { content: JSON.stringify(output), model: this.model }
  }
}

interface OpenAIResponse {
  model?: unknown
  choices?: Array<{ message?: { content?: unknown } }>
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible' as const
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly timeoutMs: number

  constructor(config: AIProviderConfig) {
    if (!config.apiKey) {
      throw new AIProviderError(
        'OpenAI-compatible Provider 未配置 AI_API_KEY。',
        'AI_PROVIDER_NOT_CONFIGURED',
        400,
      )
    }
    this.baseUrl = trimTrailingSlash(config.baseUrl || 'https://api.openai.com/v1')
    this.apiKey = config.apiKey
    this.model = config.model || 'gpt-4.1-mini'
    this.timeoutMs = config.timeoutMs
  }

  async complete(input: AICompletionInput): Promise<AICompletionResult> {
    const body = (await requestJson(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      },
      this.timeoutMs,
    )) as OpenAIResponse
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new AIProviderError(
        'OpenAI-compatible Provider 响应缺少文本结果。',
        'AI_RESPONSE_INVALID',
        502,
      )
    }
    return { content, model: typeof body.model === 'string' ? body.model : this.model }
  }
}

interface OllamaResponse {
  model?: unknown
  message?: { content?: unknown }
}

export class OllamaProvider implements AIProvider {
  readonly name = 'ollama' as const
  readonly model: string
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(config: AIProviderConfig) {
    this.baseUrl = trimTrailingSlash(config.baseUrl || 'http://localhost:11434')
    this.model = config.model || 'llama3.2'
    this.timeoutMs = config.timeoutMs
  }

  async complete(input: AICompletionInput): Promise<AICompletionResult> {
    const body = (await requestJson(
      `${this.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages,
          format: 'json',
          stream: false,
          options: { temperature: 0 },
        }),
      },
      this.timeoutMs,
    )) as OllamaResponse
    const content = body.message?.content
    if (typeof content !== 'string') {
      throw new AIProviderError(
        'Ollama 响应缺少文本结果，请确认模型已下载且支持对话接口。',
        'AI_RESPONSE_INVALID',
        502,
      )
    }
    return { content, model: typeof body.model === 'string' ? body.model : this.model }
  }
}

export function createAIProvider(config: AIProviderConfig): AIProvider {
  if (config.provider === 'openai-compatible') return new OpenAICompatibleProvider(config)
  if (config.provider === 'ollama') return new OllamaProvider(config)
  return new MockProvider(config)
}
