export { DiffValidationError } from './errors'
export {
  createReviewChunkPlan,
  type ChunkDiffOptions,
  type ReviewChunk,
  type ReviewChunkPlan,
} from './chunker'
export { parseUnifiedDiff, type ParseDiffOptions } from './parser'
export { runLocalRules } from './rules'
export { redactParsedDiff, redactSensitiveText, summarizeSensitiveFindings } from './sensitive'

import type { LocalReviewResult } from '@ai-diff-reviewer/shared'
import { parseUnifiedDiff, type ParseDiffOptions } from './parser'
import { runLocalRules } from './rules'

export function reviewDiffLocally(
  input: string,
  options: ParseDiffOptions = {},
): LocalReviewResult {
  return runLocalRules(parseUnifiedDiff(input, options))
}
