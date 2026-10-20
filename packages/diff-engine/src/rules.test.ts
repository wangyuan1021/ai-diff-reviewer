import { describe, expect, it } from 'vitest'
import { reviewDiffLocally } from './index'

const riskyDiff = `diff --git a/src/auth/session.ts b/src/auth/session.ts
index 1111111..2222222 100644
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -1,5 +1,5 @@
 export function parse(input: string) {
-  try { return JSON.parse(input) } catch { return null }
+  const apiKey = "123456789-secret"
+  console.log(input)
+  return eval(input)
 }
`

describe('runLocalRules', () => {
  it('finds security, error handling and testing risks', () => {
    const result = reviewDiffLocally(riskyDiff)
    const ruleIds = result.risks.map((risk) => risk.ruleId)

    expect(ruleIds).toContain('auth-change')
    expect(ruleIds).toContain('hardcoded-secret')
    expect(ruleIds).toContain('dynamic-code-execution')
    expect(ruleIds).toContain('debug-output')
    expect(ruleIds).toContain('removed-error-handling')
    expect(ruleIds).toContain('missing-test-change')
    expect(result.overallRisk).toBe('critical')
    expect(result.risks.find((risk) => risk.ruleId === 'hardcoded-secret')?.evidence).not.toContain(
      '123456789-secret',
    )
  })

  it('adds dependency release checks', () => {
    const diff = `diff --git a/package.json b/package.json
index 1111111..2222222 100644
--- a/package.json
+++ b/package.json
@@ -1,3 +1,4 @@
 {
+  "example": "1.0.0",
   "private": true
 }
`
    const result = reviewDiffLocally(diff)

    expect(result.risks.map((risk) => risk.ruleId)).toContain('dependency-change')
    expect(result.releaseChecklist.some((item) => item.includes('依赖安全'))).toBe(true)
  })
})
