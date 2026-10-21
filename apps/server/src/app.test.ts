import request, { type Response } from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'

const validDiff = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
 export function check(user: User) {
-  return Boolean(user)
+  console.log(user)
+  return user.role === 'admin'
 }
`

async function waitForTask(app: ReturnType<typeof createApp>, id: string): Promise<Response> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request(app.callback()).get(`/api/review-tasks/${id}`)
    if (['completed', 'failed', 'cancelled', 'timed-out'].includes(response.body.task.status)) {
      return response
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('review task did not finish')
}

describe('server API', () => {
  it('returns health status', async () => {
    const response = await request(createApp().callback()).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })

  it('returns a local review', async () => {
    const response = await request(createApp().callback())
      .post('/api/reviews/local')
      .send({ diff: validDiff })

    expect(response.status).toBe(200)
    expect(response.body.statistics.filesChanged).toBe(1)
    expect(
      response.body.risks.some((risk: { ruleId: string }) => risk.ruleId === 'auth-change'),
    ).toBe(true)
  })

  it('returns an AI review with the keyless mock provider', async () => {
    const response = await request(createApp().callback())
      .post('/api/reviews/ai')
      .send({ diff: validDiff, provider: 'mock' })

    expect(response.status).toBe(200)
    expect(response.body.ai.provider).toBe('mock')
    expect(response.body.ai.confidence).toBe(0.88)
    expect(response.body.risks.some((risk: { source: string }) => risk.source === 'ai')).toBe(true)
  })

  it('returns a clear error when OpenAI-compatible is not configured', async () => {
    const response = await request(createApp().callback())
      .post('/api/reviews/ai')
      .send({ diff: validDiff, provider: 'openai-compatible' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('AI_PROVIDER_NOT_CONFIGURED')
  })

  it('rejects invalid content', async () => {
    const response = await request(createApp().callback())
      .post('/api/reviews/local')
      .send({ diff: 'not a diff' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_DIFF')
  })

  it('creates an asynchronous task and exposes private history and Markdown', async () => {
    const app = createApp()
    const created = await request(app.callback())
      .post('/api/review-tasks')
      .send({ diff: validDiff, mode: 'local' })

    expect(created.status).toBe(202)
    const taskId = created.body.task.id as string
    const completed = await waitForTask(app, taskId)
    expect(completed.body.task.status).toBe('completed')

    const history = await request(app.callback()).get('/api/history')
    expect(history.status).toBe(200)
    expect(history.body.items[0]).toMatchObject({ id: taskId, mode: 'local' })

    const detail = await request(app.callback()).get(`/api/history/${taskId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.result.changedFiles[0].hunks).toEqual([])

    const markdown = await request(app.callback()).get(`/api/history/${taskId}/markdown`)
    expect(markdown.status).toBe(200)
    expect(markdown.headers['content-type']).toContain('text/markdown')
    expect(markdown.text).toContain('# AI Diff Review 报告')
    expect(markdown.text).not.toContain('console.log(user)')
  })

  it('streams task snapshots over SSE through completion', async () => {
    const app = createApp()
    const created = await request(app.callback())
      .post('/api/review-tasks')
      .send({ diff: validDiff, mode: 'mock' })

    const events = await request(app.callback()).get(
      `/api/review-tasks/${created.body.task.id as string}/events`,
    )

    expect(events.status).toBe(200)
    expect(events.headers['content-type']).toContain('text/event-stream')
    expect(events.text).toContain('event: task')
    expect(events.text).toContain('"status":"completed"')
  })

  it('cancels an asynchronous task', async () => {
    const app = createApp()
    const created = await request(app.callback())
      .post('/api/review-tasks')
      .send({ diff: validDiff, mode: 'local' })
    const response = await request(app.callback()).delete(
      `/api/review-tasks/${created.body.task.id as string}`,
    )

    expect(response.status).toBe(200)
    expect(['cancelled', 'completed']).toContain(response.body.task.status)
  })
})
