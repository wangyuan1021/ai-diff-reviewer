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

export type ReviewRiskSource = 'local-rule' | 'ai'

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
  source: ReviewRiskSource | 'combined'
  sources: ReviewRiskSource[]
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

export type AIProviderName = 'mock' | 'openai-compatible' | 'ollama'

export interface AIRisk {
  severity: RiskSeverity
  category: RiskCategory
  title: string
  file: string
  line: number
  evidence: string
  impact: string
  suggestion: string
}

export interface AIModelOutput {
  summary: string
  overallRisk: RiskSeverity
  confidence: number
  risks: AIRisk[]
  testSuggestions: string[]
  releaseChecklist: string[]
}

export interface AIProviderConfig {
  provider: AIProviderName
  baseUrl?: string
  apiKey?: string
  model?: string
  timeoutMs: number
}

export interface AIReviewRequest {
  diff: string
  provider?: AIProviderName
}

export interface AIReviewCoverage {
  truncated: boolean
  reviewedFiles: string[]
  skippedFiles: string[]
  reviewedChunks: number
  totalChunks: number
  omittedCharacters: number
}

export interface AIReviewMetadata {
  provider: AIProviderName
  model: string
  durationMs: number
  confidence: number
  repairAttempted: boolean
  coverage: AIReviewCoverage
}

export interface AIReviewResult extends LocalReviewResult {
  ai: AIReviewMetadata
}

export type AIProviderErrorCode =
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_NETWORK_ERROR'
  | 'AI_PROVIDER_REQUEST_FAILED'
  | 'AI_RESPONSE_INVALID'

export interface ApiError {
  error: {
    code: string
    message: string
    details?: unknown
  }
}
