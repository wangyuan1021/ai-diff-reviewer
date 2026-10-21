import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewTaskSnapshot } from '@ai-diff-reviewer/shared'
import { ReviewHistoryStore } from './history'
import { ReviewTaskManager } from './tasks'

const diff = `diff --git a/src/example.ts b/src/example.ts
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1,2 @@
 export const enabled = true
+console.log('review')
`

const stores: ReviewHistoryStore[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  for (const store of stores.splice(0)) store.close()
})

function manager(timeoutMs = 1_000): { manager: ReviewTaskManager; store: ReviewHistoryStore } {
  const store = new ReviewHistoryStore(':memory:')
  stores.push(store)
  return {
    store,
    manager: new ReviewTaskManager({
      history: store,
      maxDiffBytes: 512 * 1024,
      maxPromptCharacters: 60_000,
      timeoutMs,
      retentionMs: 60_000,
      defaultProvider: 'mock',
      providerConfig: (provider) => ({
        provider,
        apiKey: provider === 'openai-compatible' ? 'test-only-key' : undefined,
        timeoutMs: 10_000,
      }),
    }),
  }
}

function waitForTerminal(manager: ReviewTaskManager, id: string): Promise<ReviewTaskSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('task did not finish')), 2_000)
    const unsubscribe = manager.subscribe(id, (snapshot) => {
      if (!['completed', 'failed', 'cancelled', 'timed-out'].includes(snapshot.status)) return
      clearTimeout(timeout)
      unsubscribe?.()
      resolve(snapshot)
    })
  })
}

describe('ReviewTaskManager', () => {
  it('streams progress, completes a local review and writes history', async () => {
    const { manager: tasks, store } = manager()
    const created = tasks.create(diff, 'local')
    const stages: string[] = []
    tasks.subscribe(created.id, (snapshot) => stages.push(snapshot.progress.stage))

    const completed = await waitForTerminal(tasks, created.id)

    expect(completed.status).toBe('completed')
    expect(completed.historyId).toBeDefined()
    expect(completed.historyId).not.toBe(completed.id)
    expect(completed.result?.statistics.filesChanged).toBe(1)
    expect(stages).toEqual(expect.arrayContaining(['queued', 'parsing', 'local-review', 'saving']))
    expect(store.get(completed.historyId!)?.result.changedFiles[0]?.hunks).toEqual([])
    expect(store.get(created.id)).toBeNull()
  })

  it('cancels a queued task before execution', async () => {
    const { manager: tasks } = manager()
    const created = tasks.create(diff, 'local')

    const cancelled = tasks.cancel(created.id)

    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.error?.code).toBe('REVIEW_CANCELLED')
    await new Promise((resolve) => setImmediate(resolve))
    expect(tasks.get(created.id)?.status).toBe('cancelled')
  })

  it('aborts an end-to-end task after its deadline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }),
    )
    const { manager: tasks } = manager(20)
    const created = tasks.create(diff, 'openai-compatible')

    const timedOut = await waitForTerminal(tasks, created.id)

    expect(timedOut.status).toBe('timed-out')
    expect(timedOut.error?.code).toBe('REVIEW_TIMEOUT')
  })
})
