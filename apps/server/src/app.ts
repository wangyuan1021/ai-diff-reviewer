import cors from '@koa/cors'
import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { DiffValidationError, reviewDiffLocally } from '@ai-diff-reviewer/diff-engine'
import type { AIProviderName, ApiError } from '@ai-diff-reviewer/shared'
import { z } from 'zod'
import { AIProviderError } from './ai/errors'
import { createAIProvider } from './ai/providers'
import { reviewDiffWithAI } from './ai/review'
import { aiProviderNameSchema } from './ai/schemas'
import { config } from './config'

const reviewRequestSchema = z.object({
  diff: z.string().min(1, '请输入 Git Diff 内容。'),
})

const aiReviewRequestSchema = reviewRequestSchema.extend({
  provider: aiProviderNameSchema.optional(),
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

export function createApp(): Koa {
  const app = new Koa()
  const router = new Router({ prefix: '/api' })

  app.use(
    cors({
      origin: config.webOrigin,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
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
