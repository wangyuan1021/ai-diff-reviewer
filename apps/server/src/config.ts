import { fileURLToPath } from 'node:url'
import type { AIProviderName } from '@ai-diff-reviewer/shared'
import { aiProviderNameSchema } from './ai/schemas'

function toPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function toProvider(value: string | undefined): AIProviderName {
  const parsed = aiProviderNameSchema.safeParse(value)
  return parsed.success ? parsed.data : 'mock'
}

export const config = {
  port: toPositiveInteger(process.env.PORT, 3000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  maxDiffBytes: toPositiveInteger(process.env.MAX_DIFF_BYTES, 512 * 1024),
  aiProvider: toProvider(process.env.AI_PROVIDER),
  aiBaseUrl: process.env.AI_BASE_URL,
  aiApiKey: process.env.AI_API_KEY,
  aiModel: process.env.AI_MODEL,
  aiTimeoutMs: toPositiveInteger(process.env.AI_TIMEOUT_MS, 30_000),
  aiMaxPromptCharacters: toPositiveInteger(process.env.AI_MAX_PROMPT_CHARACTERS, 60_000),
  reviewTaskTimeoutMs: toPositiveInteger(process.env.REVIEW_TASK_TIMEOUT_MS, 60_000),
  reviewTaskRetentionMs: toPositiveInteger(process.env.REVIEW_TASK_RETENTION_MS, 15 * 60_000),
  databasePath:
    process.env.DATABASE_PATH ??
    fileURLToPath(new URL('../../../data/reviews.db', import.meta.url)),
}
