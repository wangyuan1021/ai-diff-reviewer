import type { ChangedFile, DiffLine, ParsedDiff } from '@ai-diff-reviewer/shared'

export interface ReviewChunk {
  id: string
  file: string
  content: string
  newLines: number[]
  priority: number
}

export interface ReviewChunkPlan {
  chunks: ReviewChunk[]
  totalChunks: number
  reviewedFiles: string[]
  skippedFiles: string[]
  truncated: boolean
  omittedCharacters: number
}

export interface ChunkDiffOptions {
  maxPromptCharacters?: number
  maxChunkCharacters?: number
}

const DEFAULT_PROMPT_CHARACTERS = 60_000
const DEFAULT_CHUNK_CHARACTERS = 12_000
const HIGH_PRIORITY_PATH =
  /(^|\/)(auth|authentication|authorization|permission|permissions|rbac|acl|migrations?|database\/migrations?|config|configs)(\/|\.|$)|(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|pom\.xml|go\.mod|requirements[^/]*\.txt)$|(^|\/)\.env(\.|$)|\.(ya?ml|toml|ini)$/i

function priorityFor(file: ChangedFile): number {
  return HIGH_PRIORITY_PATH.test(file.path) ? 0 : 1
}

function formatLine(line: DiffLine): string {
  if (line.type === 'add') return `+ ${line.newLine ?? '-'} | ${line.content}`
  if (line.type === 'delete') return `- ${line.oldLine ?? '-'} | ${line.content}`
  return `  ${line.newLine ?? '-'} | ${line.content}`
}

function makeChunk(
  file: ChangedFile,
  hunkHeader: string,
  lines: DiffLine[],
  sequence: number,
): ReviewChunk {
  const header = `FILE ${file.path} (${file.changeType}, +${file.additions}/-${file.deletions})\n${hunkHeader}`
  return {
    id: `${file.path}:${sequence}`,
    file: file.path,
    content: `${header}\n${lines.map(formatLine).join('\n')}`,
    newLines: lines.flatMap((line) => (line.newLine === undefined ? [] : [line.newLine])),
    priority: priorityFor(file),
  }
}

function chunksForFile(file: ChangedFile, maxChunkCharacters: number): ReviewChunk[] {
  if (file.hunks.length === 0) {
    return [makeChunk(file, 'NO_TEXT_HUNK', [], 1)]
  }

  const chunks: ReviewChunk[] = []
  let sequence = 0
  for (const hunk of file.hunks) {
    let currentLines: DiffLine[] = []
    for (const line of hunk.lines) {
      const candidate = [...currentLines, line]
      if (
        currentLines.length > 0 &&
        makeChunk(file, hunk.header, candidate, sequence + 1).content.length > maxChunkCharacters
      ) {
        sequence += 1
        chunks.push(makeChunk(file, hunk.header, currentLines, sequence))
        currentLines = [line]
      } else {
        currentLines = candidate
      }
    }
    sequence += 1
    chunks.push(makeChunk(file, hunk.header, currentLines, sequence))
  }
  return chunks
}

export function createReviewChunkPlan(
  parsed: ParsedDiff,
  options: ChunkDiffOptions = {},
): ReviewChunkPlan {
  const maxPromptCharacters = options.maxPromptCharacters ?? DEFAULT_PROMPT_CHARACTERS
  const maxChunkCharacters = Math.min(
    options.maxChunkCharacters ?? DEFAULT_CHUNK_CHARACTERS,
    maxPromptCharacters,
  )
  const candidates = parsed.files
    .flatMap((file) => chunksForFile(file, maxChunkCharacters))
    .sort((left, right) => left.priority - right.priority)
  const chunks: ReviewChunk[] = []
  let usedCharacters = 0
  let omittedCharacters = 0

  for (const chunk of candidates) {
    if (usedCharacters + chunk.content.length <= maxPromptCharacters) {
      chunks.push(chunk)
      usedCharacters += chunk.content.length
    } else {
      omittedCharacters += chunk.content.length
    }
  }

  const reviewedFileSet = new Set(chunks.map((chunk) => chunk.file))
  const skippedFiles = parsed.files
    .map((file) => file.path)
    .filter((file) => !reviewedFileSet.has(file))

  return {
    chunks,
    totalChunks: candidates.length,
    reviewedFiles: [...reviewedFileSet],
    skippedFiles,
    truncated: chunks.length < candidates.length,
    omittedCharacters,
  }
}
