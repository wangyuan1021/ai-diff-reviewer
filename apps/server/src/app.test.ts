import request from 'supertest'
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

  it('rejects invalid content', async () => {
    const response = await request(createApp().callback())
      .post('/api/reviews/local')
      .send({ diff: 'not a diff' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('INVALID_DIFF')
  })
})
