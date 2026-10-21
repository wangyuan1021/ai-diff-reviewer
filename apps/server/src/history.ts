import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync as Database } from 'node:sqlite'
import type {
  AIProviderName,
  DiffStatistics,
  ReviewHistoryDetail,
  ReviewHistoryList,
  ReviewHistorySummary,
  ReviewMode,
  ReviewResult,
  RiskSeverity,
} from '@ai-diff-reviewer/shared'

type DatabaseConstructor = new (path: string) => Database

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: DatabaseConstructor
}

interface HistoryRow {
  id: string
  diff_hash: string
  mode: string
  provider: string | null
  model: string | null
  overall_risk: string
  statistics_json: string
  risk_count: number
  result_json?: string
  created_at: string
  completed_at: string
  duration_ms: number
}

export interface SaveReviewInput {
  id: string
  diffHash: string
  mode: ReviewMode
  result: ReviewResult
  createdAt: string
  completedAt: string
}

function withoutDiffContent(result: ReviewResult): ReviewResult {
  const changedContent = result.changedFiles
    .flatMap((file) =>
      file.hunks.flatMap((hunk) =>
        hunk.lines
          .filter((line) => line.type !== 'context')
          .flatMap((line) => [line.content, `+${line.content}`, `-${line.content}`]),
      ),
    )
    .filter((content) => content.trim().length >= 4)
  const clone = JSON.parse(JSON.stringify(result)) as ReviewResult
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return changedContent.reduce(
        (current, content) => current.split(content).join('[已脱敏]'),
        value,
      )
    }
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]))
    }
    return value
  }
  const sanitized = redact(clone) as ReviewResult
  return {
    ...sanitized,
    changedFiles: sanitized.changedFiles.map((file) => ({ ...file, hunks: [] })),
  }
}

function summaryFromRow(row: HistoryRow): ReviewHistorySummary {
  return {
    id: row.id,
    diffHash: row.diff_hash,
    mode: row.mode as ReviewMode,
    ...(row.provider ? { provider: row.provider as AIProviderName } : {}),
    ...(row.model ? { model: row.model } : {}),
    overallRisk: row.overall_risk as RiskSeverity,
    statistics: JSON.parse(row.statistics_json) as DiffStatistics,
    riskCount: row.risk_count,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
  }
}

export class ReviewHistoryStore {
  private readonly database: Database

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true })
    }
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        diff_hash TEXT NOT NULL,
        mode TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        overall_risk TEXT NOT NULL,
        statistics_json TEXT NOT NULL,
        risk_count INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reviews_completed_at_idx
      ON reviews (completed_at DESC);
    `)
  }

  save(input: SaveReviewInput): ReviewHistoryDetail {
    const result = withoutDiffContent(input.result)
    const ai = 'ai' in result ? result.ai : undefined
    const durationMs = Math.max(
      0,
      new Date(input.completedAt).getTime() - new Date(input.createdAt).getTime(),
    )
    this.database
      .prepare(
        `INSERT OR REPLACE INTO reviews (
          id, diff_hash, mode, provider, model, overall_risk, statistics_json,
          risk_count, result_json, created_at, completed_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.diffHash,
        input.mode,
        ai?.provider ?? null,
        ai?.model ?? null,
        result.overallRisk,
        JSON.stringify(result.statistics),
        result.risks.length,
        JSON.stringify(result),
        input.createdAt,
        input.completedAt,
        durationMs,
      )
    return this.get(input.id)!
  }

  list(limit = 20, offset = 0): ReviewHistoryList {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100)
    const safeOffset = Math.max(Math.trunc(offset), 0)
    const rows = this.database
      .prepare(
        `SELECT id, diff_hash, mode, provider, model, overall_risk, statistics_json,
          risk_count, created_at, completed_at, duration_ms
        FROM reviews ORDER BY completed_at DESC LIMIT ? OFFSET ?`,
      )
      .all(safeLimit, safeOffset) as unknown as HistoryRow[]
    const count = this.database.prepare('SELECT COUNT(*) AS total FROM reviews').get() as {
      total: number
    }
    return { items: rows.map(summaryFromRow), total: count.total }
  }

  get(id: string): ReviewHistoryDetail | null {
    const row = this.database
      .prepare(
        `SELECT id, diff_hash, mode, provider, model, overall_risk, statistics_json,
          risk_count, result_json, created_at, completed_at, duration_ms
        FROM reviews WHERE id = ?`,
      )
      .get(id) as unknown as HistoryRow | undefined
    if (!row?.result_json) return null
    return { ...summaryFromRow(row), result: JSON.parse(row.result_json) as ReviewResult }
  }

  close(): void {
    this.database.close()
  }
}

export function sanitizeReviewResult(result: ReviewResult): ReviewResult {
  return withoutDiffContent(result)
}
