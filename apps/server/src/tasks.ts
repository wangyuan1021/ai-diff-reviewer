import { createHash, randomUUID } from 'node:crypto'
import { parseUnifiedDiff, runLocalRules, DiffValidationError } from '@ai-diff-reviewer/diff-engine'
import type {
  AIProviderName,
  ReviewMode,
  ReviewTaskProgress,
  ReviewTaskSnapshot,
  ReviewTaskStatus,
} from '@ai-diff-reviewer/shared'
import { AIProviderError } from './ai/errors'
import { createAIProvider } from './ai/providers'
import { reviewDiffWithAI } from './ai/review'
import type { ReviewHistoryStore } from './history'

interface TaskManagerOptions {
  history: ReviewHistoryStore
  maxDiffBytes: number
  maxPromptCharacters: number
  timeoutMs: number
  retentionMs: number
  defaultProvider: AIProviderName
  providerConfig: (provider: AIProviderName) => {
    provider: AIProviderName
    baseUrl?: string
    apiKey?: string
    model?: string
    timeoutMs: number
  }
}

interface TaskRecord {
  snapshot: ReviewTaskSnapshot
  controller: AbortController
  timedOut: boolean
  listeners: Set<(snapshot: ReviewTaskSnapshot) => void>
}

const terminalStatuses = new Set<ReviewTaskStatus>([
  'completed',
  'failed',
  'cancelled',
  'timed-out',
])

const progressMessages: Record<ReviewTaskProgress['stage'], string> = {
  queued: '任务已创建，等待执行。',
  parsing: '正在解析并校验 Diff。',
  'local-review': '正在执行本地风险规则。',
  'ai-review': '正在调用 AI Provider。',
  saving: '正在保存隐私安全的审查记录。',
  completed: '审查完成。',
}

export class ReviewTaskManager {
  private readonly tasks = new Map<string, TaskRecord>()

  constructor(private readonly options: TaskManagerOptions) {}

  create(diff: string, requestedMode?: ReviewMode): ReviewTaskSnapshot {
    const mode = requestedMode ?? this.options.defaultProvider
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const record: TaskRecord = {
      snapshot: {
        id,
        status: 'queued',
        mode,
        progress: { stage: 'queued', percent: 0, message: progressMessages.queued },
        createdAt,
      },
      controller: new AbortController(),
      timedOut: false,
      listeners: new Set(),
    }
    this.tasks.set(id, record)
    setImmediate(() => void this.execute(record, diff))
    return record.snapshot
  }

  get(id: string): ReviewTaskSnapshot | null {
    return this.tasks.get(id)?.snapshot ?? null
  }

  cancel(id: string): ReviewTaskSnapshot | null {
    const record = this.tasks.get(id)
    if (!record) return null
    if (terminalStatuses.has(record.snapshot.status)) return record.snapshot
    record.controller.abort()
    this.finish(record, 'cancelled', {
      code: 'REVIEW_CANCELLED',
      message: '审查任务已取消。',
    })
    return record.snapshot
  }

  subscribe(id: string, listener: (snapshot: ReviewTaskSnapshot) => void): (() => void) | null {
    const record = this.tasks.get(id)
    if (!record) return null
    record.listeners.add(listener)
    listener(record.snapshot)
    return () => record.listeners.delete(listener)
  }

  private updateProgress(
    record: TaskRecord,
    stage: ReviewTaskProgress['stage'],
    percent: number,
  ): void {
    if (terminalStatuses.has(record.snapshot.status)) return
    record.snapshot = {
      ...record.snapshot,
      status: stage === 'queued' ? 'queued' : 'running',
      progress: { stage, percent, message: progressMessages[stage] },
      ...(record.snapshot.startedAt ? {} : { startedAt: new Date().toISOString() }),
    }
    this.notify(record)
  }

  private async execute(record: TaskRecord, diff: string): Promise<void> {
    if (terminalStatuses.has(record.snapshot.status)) return
    const timeout = setTimeout(() => {
      record.timedOut = true
      record.controller.abort()
    }, this.options.timeoutMs)

    try {
      let result
      if (record.snapshot.mode === 'local') {
        this.updateProgress(record, 'parsing', 10)
        const parsed = parseUnifiedDiff(diff, { maxBytes: this.options.maxDiffBytes })
        record.controller.signal.throwIfAborted()
        this.updateProgress(record, 'local-review', 45)
        result = runLocalRules(parsed)
      } else {
        const provider = createAIProvider(this.options.providerConfig(record.snapshot.mode))
        result = await reviewDiffWithAI(diff, provider, {
          maxBytes: this.options.maxDiffBytes,
          maxPromptCharacters: this.options.maxPromptCharacters,
          signal: record.controller.signal,
          onProgress: (stage, percent) => this.updateProgress(record, stage, percent),
        })
      }

      record.controller.signal.throwIfAborted()
      this.updateProgress(record, 'saving', 92)
      const completedAt = new Date().toISOString()
      this.options.history.save({
        id: record.snapshot.id,
        diffHash: createHash('sha256').update(diff).digest('hex'),
        mode: record.snapshot.mode,
        result,
        createdAt: record.snapshot.createdAt,
        completedAt,
      })
      record.snapshot = {
        ...record.snapshot,
        status: 'completed',
        progress: { stage: 'completed', percent: 100, message: progressMessages.completed },
        result,
        completedAt,
      }
      this.notify(record)
      this.scheduleCleanup(record)
    } catch (error) {
      if (record.snapshot.status === 'cancelled') return
      if (record.timedOut) {
        this.finish(record, 'timed-out', {
          code: 'REVIEW_TIMEOUT',
          message: `审查任务超过 ${this.options.timeoutMs}ms，已自动终止。`,
        })
        return
      }
      if (error instanceof DiffValidationError || error instanceof AIProviderError) {
        this.finish(record, 'failed', { code: error.code, message: error.message })
        return
      }
      this.finish(record, 'failed', {
        code: 'INTERNAL_ERROR',
        message: '服务暂时无法完成分析。',
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private finish(
    record: TaskRecord,
    status: Extract<ReviewTaskStatus, 'failed' | 'cancelled' | 'timed-out'>,
    error: { code: string; message: string },
  ): void {
    record.snapshot = {
      ...record.snapshot,
      status,
      error,
      completedAt: new Date().toISOString(),
    }
    this.notify(record)
    this.scheduleCleanup(record)
  }

  private notify(record: TaskRecord): void {
    for (const listener of record.listeners) listener(record.snapshot)
  }

  private scheduleCleanup(record: TaskRecord): void {
    const timeout = setTimeout(
      () => this.tasks.delete(record.snapshot.id),
      this.options.retentionMs,
    )
    timeout.unref()
  }
}
