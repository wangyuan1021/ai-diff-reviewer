import cors from '@koa/cors'
import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { DiffValidationError, reviewDiffLocally } from '@ai-diff-reviewer/diff-engine'
import type { ApiError } from '@ai-diff-reviewer/shared'
import { z } from 'zod'
import { config } from './config'

const reviewRequestSchema = z.object({
  diff: z.string().min(1, '请输入 Git Diff 内容。'),
})

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
