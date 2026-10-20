import { describe, expect, it } from 'vitest'
import { createReviewChunkPlan } from './chunker'
import { parseUnifiedDiff } from './parser'

const diff = `diff --git a/src/feature.ts b/src/feature.ts
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1 +1,2 @@
 export const enabled = true
+export const label = 'example'
diff --git a/src/auth/access.ts b/src/auth/access.ts
--- a/src/auth/access.ts
+++ b/src/auth/access.ts
@@ -1 +1,2 @@
 export const role = 'user'
+export const canEdit = true
`

describe('createReviewChunkPlan', () => {
  it('prioritizes sensitive paths and reports truncation', () => {
    const parsed = parseUnifiedDiff(diff)
    const authOnlyBudget = 130
    const plan = createReviewChunkPlan(parsed, {
      maxPromptCharacters: authOnlyBudget,
      maxChunkCharacters: authOnlyBudget,
    })

    expect(plan.truncated).toBe(true)
    expect(plan.chunks[0]?.file).toBe('src/auth/access.ts')
    expect(plan.reviewedFiles).toContain('src/auth/access.ts')
    expect(plan.skippedFiles).toContain('src/feature.ts')
    expect(plan.omittedCharacters).toBeGreaterThan(0)
  })

  it('preserves valid new line numbers in chunks', () => {
    const plan = createReviewChunkPlan(parseUnifiedDiff(diff))
    const featureChunk = plan.chunks.find((chunk) => chunk.file === 'src/feature.ts')

    expect(featureChunk?.newLines).toEqual([1, 2])
    expect(featureChunk?.content).toContain("+ 2 | +export const label = 'example'")
  })
})
