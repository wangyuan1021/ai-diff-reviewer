import type { AIProviderErrorCode } from '@ai-diff-reviewer/shared'

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly code: AIProviderErrorCode,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}
