import parseDiff from 'parse-diff'
import type {
  ChangedFile,
  ChangeType,
  DiffHunk,
  DiffLine,
  DiffStatistics,
  ParsedDiff,
} from '@ai-diff-reviewer/shared'
import { DiffValidationError } from './errors'

export interface ParseDiffOptions {
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 512 * 1024

function normalizePath(path?: string): string | null {
  if (!path || path === '/dev/null') return null
  return path.replace(/^[ab]\//, '')
}

function inferChangeType(oldPath: string | null, newPath: string | null): ChangeType {
  if (!oldPath) return 'added'
  if (!newPath) return 'deleted'
  if (oldPath !== newPath) return 'renamed'
  return 'modified'
}

function toLine(change: {
  type: string
  content: string
  ln?: number
  ln1?: number
  ln2?: number
}): DiffLine {
  if (change.type === 'add') {
    return { type: 'add', content: change.content, newLine: change.ln }
  }
  if (change.type === 'del') {
    return { type: 'delete', content: change.content, oldLine: change.ln }
  }
  return {
    type: 'context',
    content: change.content,
    oldLine: change.ln1,
    newLine: change.ln2,
  }
}

function parseHunkHeader(header: string): Omit<DiffHunk, 'header' | 'lines'> {
  const match = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  return {
    oldStart: Number(match?.[1] ?? 0),
    oldLines: Number(match?.[2] ?? 1),
    newStart: Number(match?.[3] ?? 0),
    newLines: Number(match?.[4] ?? 1),
  }
}

export function parseUnifiedDiff(input: string, options: ParseDiffOptions = {}): ParsedDiff {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new DiffValidationError('请输入 Git Diff 内容。', 'EMPTY_DIFF')
  }

  const byteLength = Buffer.byteLength(input, 'utf8')
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  if (byteLength > maxBytes) {
    throw new DiffValidationError(
      `Diff 大小为 ${byteLength} 字节，超过 ${maxBytes} 字节限制。`,
      'DIFF_TOO_LARGE',
    )
  }

  if (!input.includes('diff --git') && !(input.includes('--- ') && input.includes('+++ '))) {
    throw new DiffValidationError('内容不是可识别的 Unified Diff。', 'INVALID_DIFF')
  }

  let parsedFiles: ReturnType<typeof parseDiff>
  try {
    parsedFiles = parseDiff(input)
  } catch {
    throw new DiffValidationError('Diff 解析失败，请检查内容是否完整。', 'INVALID_DIFF')
  }

  if (parsedFiles.length === 0) {
    throw new DiffValidationError('Diff 中没有可分析的文件变更。', 'INVALID_DIFF')
  }

  const files: ChangedFile[] = parsedFiles.map((file) => {
    const oldPath = normalizePath(file.from)
    const newPath = normalizePath(file.to)
    const path = newPath ?? oldPath ?? 'unknown-file'
    return {
      oldPath,
      newPath,
      path,
      changeType: inferChangeType(oldPath, newPath),
      additions: file.additions,
      deletions: file.deletions,
      hunks: file.chunks.map((chunk) => ({
        header: chunk.content,
        ...parseHunkHeader(chunk.content),
        lines: chunk.changes.map(toLine),
      })),
    }
  })

  const byType: DiffStatistics['byType'] = {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  }
  for (const file of files) byType[file.changeType] += 1

  const additions = files.reduce((sum, file) => sum + file.additions, 0)
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0)

  return {
    files,
    statistics: {
      filesChanged: files.length,
      additions,
      deletions,
      totalChangedLines: additions + deletions,
      byType,
    },
    warnings: [],
  }
}
