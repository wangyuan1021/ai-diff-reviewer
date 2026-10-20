import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DiffValidationError } from './errors'
import { parseUnifiedDiff } from './parser'

const multiFileDiff = `diff --git a/src/main.ts b/src/main.ts
index 1111111..2222222 100644
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
 export function run() {
-  return false
+  const ready = true
+  return ready
 }
diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`

describe('parseUnifiedDiff', () => {
  it('parses statistics, paths and line numbers', () => {
    const result = parseUnifiedDiff(multiFileDiff)

    expect(result.statistics).toMatchObject({
      filesChanged: 2,
      additions: 2,
      deletions: 1,
      totalChangedLines: 3,
    })
    expect(result.files[0]).toMatchObject({
      path: 'src/main.ts',
      changeType: 'modified',
    })
    expect(result.files[0]?.hunks[0]?.lines.find((line) => line.type === 'add')).toMatchObject({
      newLine: 2,
    })
    expect(result.files[1]).toMatchObject({
      oldPath: 'src/old.ts',
      newPath: 'src/new.ts',
      changeType: 'renamed',
    })
  })

  it('rejects empty, invalid and oversized content', () => {
    expect(() => parseUnifiedDiff('')).toThrowError(DiffValidationError)
    expect(() => parseUnifiedDiff('plain text')).toThrowError(/Unified Diff/)
    expect(() => parseUnifiedDiff(multiFileDiff, { maxBytes: 10 })).toThrowError(/超过/)
  })

  it('keeps the bundled multi-file demo valid', () => {
    const demo = readFileSync(
      new URL('../../../samples/day-01-risky.diff', import.meta.url),
      'utf8',
    )
    const result = parseUnifiedDiff(demo)

    expect(result.statistics).toMatchObject({
      filesChanged: 2,
      additions: 4,
      deletions: 5,
    })
    expect(result.files.map((file) => file.path)).toEqual([
      'src/auth/permission.ts',
      'package.json',
    ])
  })
})
