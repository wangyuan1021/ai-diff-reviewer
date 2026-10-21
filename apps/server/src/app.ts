import cors from '@koa/cors'
import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { DiffValidationError, reviewDiffLocally } from '@ai-diff-reviewer/diff-engine'
import type { AIProviderName, ApiError, ReviewTaskSnapshot } from '@ai-diff-reviewer/shared'
import { z } from 'zod'
import { AIProviderError } from './ai/errors'
import { createAIProvider } from './ai/providers'
import { reviewDiffWithAI } from './ai/review'
import { aiProviderNameSchema } from './ai/schemas'
import { config } from './config'
import { ReviewHistoryStore } from './history'
import { reviewToMarkdown } from './markdown'
import { ReviewTaskManager } from './tasks'

const reviewRequestSchema = z.object({
  diff: z.string().min(1, '请输入 Git Diff 内容。'),
})

const aiReviewRequestSchema = reviewRequestSchema.extend({
  provider: aiProviderNameSchema.optional(),
})

const reviewModeSchema = z.union([z.literal('local'), aiProviderNameSchema])

const taskRequestSchema = reviewRequestSchema.extend({
  mode: reviewModeSchema.optional(),
})

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

function providerConfig(provider: AIProviderName) {
  return {
    provider,
    baseUrl: config.aiBaseUrl,
    apiKey: config.aiApiKey,
    model: config.aiModel,
    timeoutMs: config.aiTimeoutMs,
  }
}

export interface AppOptions {
  history?: ReviewHistoryStore
  tasks?: ReviewTaskManager
}

function isTerminalTask(task: ReviewTaskSnapshot): boolean {
  return ['completed', 'failed', 'cancelled', 'timed-out'].includes(task.status)
}

export function createApp(options: AppOptions = {}): Koa {
  const app = new Koa()
  const router = new Router({ prefix: '/api' })
  const history =
    options.history ??
    new ReviewHistoryStore(process.env.NODE_ENV === 'test' ? ':memory:' : config.databasePath)
  const tasks =
    options.tasks ??
    new ReviewTaskManager({
      history,
      maxDiffBytes: config.maxDiffBytes,
      maxPromptCharacters: config.aiMaxPromptCharacters,
      timeoutMs: config.reviewTaskTimeoutMs,
      retentionMs: config.reviewTaskRetentionMs,
      defaultProvider: config.aiProvider,
      providerConfig,
    })

  app.use(
    cors({
      origin: config.webOrigin,
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    }),
  )
  app.use(bodyParser({ jsonLimit: `${Math.ceil(config.maxDiffBytes / 1024) + 16}kb` }))

  router.get('/health', (context) => {
    context.body = {
      status: 'ok',
      service: 'ai-diff-reviewer-server',
      timestamp: new Date().toISOString(),
    }
  })

  router.post('/reviews/local', (context) => {
    const request = reviewRequestSchema.safeParse(context.request.body)
    if (!request.success) {
      context.status = 400
      context.body = {
        error: {
          code: 'INVALID_REQUEST',
          message: request.error.issues[0]?.message ?? '请求参数不正确。',
          details: request.error.flatten(),
        },
      } satisfies ApiError
      return
    }

    context.body = reviewDiffLocally(request.data.diff, { maxBytes: config.maxDiffBytes })
  })

  router.post('/reviews/ai', async (context) => {
    const request = aiReviewRequestSchema.safeParse(context.request.body)
    if (!request.success) {
      context.status = 400
      context.body = {
        error: {
          code: 'INVALID_REQUEST',
          message: request.error.issues[0]?.message ?? '请求参数不正确。',
          details: request.error.flatten(),
        },
      } satisfies ApiError
      return
    }

    const provider = createAIProvider(providerConfig(request.data.provider ?? config.aiProvider))
    context.body = await reviewDiffWithAI(request.data.diff, provider, {
      maxBytes: config.maxDiffBytes,
      maxPromptCharacters: config.aiMaxPromptCharacters,
    })
  })

  router.post('/review-tasks', (context) => {
    const request = taskRequestSchema.safeParse(context.request.body)
    if (!request.success) {
      context.status = 400
      context.body = {
        error: {
          code: 'INVALID_REQUEST',
          message: request.error.issues[0]?.message ?? '请求参数不正确。',
          details: request.error.flatten(),
        },
      } satisfies ApiError
      return
    }
    context.status = 202
    context.body = { task: tasks.create(request.data.diff, request.data.mode) }
  })

  router.get('/review-tasks/:id', (context) => {
    const task = tasks.get(context.params.id ?? '')
    if (!task) {
      context.status = 404
      context.body = {
        error: { code: 'TASK_NOT_FOUND', message: '审查任务不存在或已过期。' },
      } satisfies ApiError
      return
    }
    context.body = { task }
  })

  router.delete('/review-tasks/:id', (context) => {
    const task = tasks.cancel(context.params.id ?? '')
    if (!task) {
      context.status = 404
      context.body = {
        error: { code: 'TASK_NOT_FOUND', message: '审查任务不存在或已过期。' },
      } satisfies ApiError
      return
    }
    context.body = { task }
  })

  router.get('/review-tasks/:id/events', (context) => {
    const taskId = context.params.id ?? ''
    if (!tasks.get(taskId)) {
      context.status = 404
      context.body = {
        error: { code: 'TASK_NOT_FOUND', message: '审查任务不存在或已过期。' },
      } satisfies ApiError
      return
    }

    context.respond = false
    context.res.statusCode = 200
    context.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    context.res.setHeader('Cache-Control', 'no-cache, no-transform')
    context.res.setHeader('Connection', 'keep-alive')
    context.res.flushHeaders()

    let unsubscribe: (() => void) | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null
    const cleanup = () => {
      unsubscribe?.()
      if (heartbeat) clearInterval(heartbeat)
    }
    unsubscribe = tasks.subscribe(taskId, (task) => {
      if (context.res.writableEnded) return
      context.res.write(`event: task\ndata: ${JSON.stringify(task)}\n\n`)
      if (isTerminalTask(task)) {
        setImmediate(() => {
          cleanup()
          context.res.end()
        })
      }
    })
    heartbeat = setInterval(() => {
      if (!context.res.writableEnded) context.res.write(': heartbeat\n\n')
    }, 15_000)
    context.res.on('close', cleanup)
  })

  router.get('/history', (context) => {
    const query = historyQuerySchema.safeParse(context.query)
    if (!query.success) {
      context.status = 400
      context.body = {
        error: {
          code: 'INVALID_REQUEST',
          message: query.error.issues[0]?.message ?? '分页参数不正确。',
        },
      } satisfies ApiError
      return
    }
    context.body = history.list(query.data.limit, query.data.offset)
  })

  router.get('/history/:id', (context) => {
    const review = history.get(context.params.id ?? '')
    if (!review) {
      context.status = 404
      context.body = {
        error: { code: 'HISTORY_NOT_FOUND', message: '历史审查记录不存在。' },
      } satisfies ApiError
      return
    }
    context.body = review
  })

  router.get('/history/:id/markdown', (context) => {
    const review = history.get(context.params.id ?? '')
    if (!review) {
      context.status = 404
      context.body = {
        error: { code: 'HISTORY_NOT_FOUND', message: '历史审查记录不存在。' },
      } satisfies ApiError
      return
    }
    context.type = 'text/markdown; charset=utf-8'
    context.set('Content-Disposition', `attachment; filename="review-${review.id}.md"`)
    context.body = reviewToMarkdown(review)
  })

  app.use(async (context, next) => {
    try {
      await next()
      if (context.status === 404) {
        context.body = {
          error: { code: 'NOT_FOUND', message: '请求的接口不存在。' },
        } satisfies ApiError
      }
    } catch (error) {
      if (error instanceof DiffValidationError) {
        context.status = error.code === 'DIFF_TOO_LARGE' ? 413 : 400
        context.body = {
          error: { code: error.code, message: error.message },
        } satisfies ApiError
        return
      }

      if (error instanceof AIProviderError) {
        context.status = error.status
        context.body = {
          error: { code: error.code, message: error.message, details: error.details },
        } satisfies ApiError
        return
      }

      context.status = 500
      context.body = {
        error: { code: 'INTERNAL_ERROR', message: '服务暂时无法完成分析。' },
      } satisfies ApiError
      context.app.emit('error', error, context)
    }
  })

  app.use(router.routes())
  app.use(router.allowedMethods())

  return app
}
