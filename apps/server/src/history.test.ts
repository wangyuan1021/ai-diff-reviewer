import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { reviewDiffLocally } from '@ai-diff-reviewer/diff-engine'
import { ReviewHistoryStore } from './history'
import { reviewToMarkdown } from './markdown'

const rawSecretMarker = 'RAW_DIFF_MUST_NOT_BE_STORED'
const diff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1,2 @@
 export const enabled = true
+console.log('${rawSecretMarker}')
`

const stores: ReviewHistoryStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

describe('ReviewHistoryStore', () => {
  it('stores a hash and structured result without raw diff lines', () => {
    const databasePath = join(tmpdir(), `ai-diff-reviewer-${randomUUID()}.db`)
    const store = new ReviewHistoryStore(databasePath)
    stores.push(store)
    const result = reviewDiffLocally(diff)

    const saved = store.save({
      id: 'review-1',
      diffHash: 'a'.repeat(64),
      mode: 'local',
      result,
      createdAt: '2026-10-21T00:00:00.000Z',
      completedAt: '2026-10-21T00:00:01.000Z',
    })

    expect(saved.diffHash).toBe('a'.repeat(64))
    expect(saved.result.changedFiles[0]?.hunks).toEqual([])
    expect(store.list().items).toHaveLength(1)
    store.close()
    stores.pop()
    expect(readFileSync(databasePath).includes(Buffer.from(rawSecretMarker))).toBe(false)
  })

  it('exports a useful Markdown report without code content', () => {
    const store = new ReviewHistoryStore(':memory:')
    stores.push(store)
    const saved = store.save({
      id: 'review-markdown',
      diffHash: 'b'.repeat(64),
      mode: 'local',
      result: reviewDiffLocally(diff),
      createdAt: '2026-10-21T00:00:00.000Z',
      completedAt: '2026-10-21T00:00:01.000Z',
    })

    const markdown = reviewToMarkdown(saved)

    expect(markdown).toContain('# AI Diff Review 报告')
    expect(markdown).toContain('Diff SHA-256')
    expect(markdown).not.toContain(rawSecretMarker)
  })
})
