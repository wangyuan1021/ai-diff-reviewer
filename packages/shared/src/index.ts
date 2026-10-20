export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed'

export type DiffLineType = 'add' | 'delete' | 'context'

export interface DiffLine {
  type: DiffLineType
  content: string
  oldLine?: number
  newLine?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface ChangedFile {
  oldPath: string | null
  newPath: string | null
  path: string
  changeType: ChangeType
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface DiffStatistics {
  filesChanged: number
  additions: number
  deletions: number
  totalChangedLines: number
  byType: Record<ChangeType, number>
}

export interface ParsedDiff {
  files: ChangedFile[]
  statistics: DiffStatistics
  warnings: string[]
}

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical'

export type RiskCategory =
  | 'correctness'
  | 'security'
  | 'performance'
  | 'compatibility'
  | 'maintainability'
  | 'testing'
  | 'configuration'
  | 'dependency'

export interface ReviewRisk {
  id: string
  severity: RiskSeverity
  category: RiskCategory
  title: string
  file: string
  line?: number
  evidence: string
  impact: string
  suggestion: string
  source: 'local-rule' | 'ai'
  ruleId: string
}

export interface LocalReviewResult {
  summary: string
  overallRisk: RiskSeverity
  changedFiles: ChangedFile[]
  statistics: DiffStatistics
  risks: ReviewRisk[]
  testSuggestions: string[]
  releaseChecklist: string[]
  warnings: string[]
  analyzedAt: string
}

export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}
