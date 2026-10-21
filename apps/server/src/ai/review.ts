import {
  createReviewChunkPlan,
  parseUnifiedDiff,
  runLocalRules,
  type ReviewChunk,
} from '@ai-diff-reviewer/diff-engine'
import type {
  AIModelOutput,
  AIReviewResult,
  ParsedDiff,
  ReviewRisk,
  RiskSeverity,
} from '@ai-diff-reviewer/shared'
import { AIProviderError } from './errors'
import type { AICompletionInput, AIProvider, ProviderMessage } from './providers'
import { aiModelOutputSchema } from './schemas'

export interface AIReviewOptions {
  maxBytes: number
  maxPromptCharacters: number
  signal?: AbortSignal
  onProgress?: (stage: 'parsing' | 'local-review' | 'ai-review', percent: number) => void
}

const SYSTEM_PROMPT = `你是严格的 Git Diff 风险审查器。只根据用户提供的变更证据判断，不猜测未展示的代码。
只返回单个 JSON 对象，不要 Markdown、代码围栏或额外文字。字段必须严格符合：
{"summary":string,"overallRisk":"low|medium|high|critical","confidence":0到1,"risks":[{"severity":"low|medium|high|critical","category":"correctness|security|performance|compatibility|maintainability|testing|configuration|dependency","title":string,"file":string,"line":正整数,"evidence":string,"impact":string,"suggestion":string}],"testSuggestions":string[],"releaseChecklist":string[]}
每条风险必须引用 FILE 列表中的精确路径，line 必须是对应分块中展示的新文件行号。没有可靠证据时不要输出风险。最多输出 20 条风险。`

function buildMessages(
  parsed: ParsedDiff,
  chunks: ReviewChunk[],
  localRisks: ReviewRisk[],
): ProviderMessage[] {
  const fileList = parsed.files.map((file) => ({
    path: file.path,
    changeType: file.changeType,
    additions: file.additions,
    deletions: file.deletions,
  }))
  const localEvidence = localRisks.map((risk) => ({
    severity: risk.severity,
    category: risk.category,
    title: risk.title,
    file: risk.file,
    line: risk.line,
    evidence: risk.evidence,
  }))
  const userPrompt = [
    `统计：${JSON.stringify(parsed.statistics)}`,
    `文件：${JSON.stringify(fileList)}`,
    `本地规则结果（可复核、不要无证据重复）：${JSON.stringify(localEvidence)}`,
    '待审查分块：',
    ...chunks.map((chunk) => `--- CHUNK ${chunk.id} ---\n${chunk.content}`),
  ].join('\n')
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}

function parseModelOutput(content: string): AIModelOutput | null {
  try {
    const json: unknown = JSON.parse(content)
    const parsed = aiModelOutputSchema.safeParse(json)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function validLinesByFile(chunks: ReviewChunk[]): Map<string, Set<number>> {
  const lines = new Map<string, Set<number>>()
  for (const chunk of chunks) {
    const fileLines = lines.get(chunk.file) ?? new Set<number>()
    for (const line of chunk.newLines) fileLines.add(line)
    lines.set(chunk.file, fileLines)
  }
  return lines
}

function severityMax(risks: ReviewRisk[], fallback: RiskSeverity): RiskSeverity {
  const weight: Record<RiskSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 }
  return risks.reduce(
    (highest, risk) => (weight[risk.severity] > weight[highest] ? risk.severity : highest),
    fallback,
  )
}

function mergeRisks(localRisks: ReviewRisk[], aiRisks: ReviewRisk[]): ReviewRisk[] {
  const merged = localRisks.map((risk) => ({ ...risk, sources: [...risk.sources] }))
  for (const aiRisk of aiRisks) {
    const duplicate = merged.find(
      (risk) =>
        risk.file === aiRisk.file &&
        risk.category === aiRisk.category &&
        risk.line === aiRisk.line &&
        risk.title.trim().toLocaleLowerCase() === aiRisk.title.trim().toLocaleLowerCase(),
    )
    if (duplicate) {
      duplicate.source = 'combined'
      duplicate.sources = ['local-rule', 'ai']
      duplicate.evidence = `${duplicate.evidence} AI 复核：${aiRisk.evidence}`
      continue
    }
    merged.push(aiRisk)
  }
  return merged
}

async function getValidatedOutput(
  provider: AIProvider,
  input: AICompletionInput,
): Promise<{ output: AIModelOutput; model: string; repairAttempted: boolean }> {
  const first = await provider.complete(input)
  const parsed = parseModelOutput(first.content)
  if (parsed) return { output: parsed, model: first.model, repairAttempted: false }

  const repairMessages: ProviderMessage[] = [
    ...input.messages,
    {
      role: 'user',
      content:
        '上一个响应不是符合 Schema 的纯 JSON。请重新生成，只返回严格符合系统消息 Schema 的 JSON 对象。',
    },
  ]
  const repaired = await provider.complete({ ...input, messages: repairMessages })
  const repairedOutput = parseModelOutput(repaired.content)
  if (!repairedOutput) {
    throw new AIProviderError(
      'AI Provider 两次返回的内容均未通过结构化校验。',
      'AI_RESPONSE_INVALID',
      502,
    )
  }
  return { output: repairedOutput, model: repaired.model, repairAttempted: true }
}

export async function reviewDiffWithAI(
  diff: string,
  provider: AIProvider,
  options: AIReviewOptions,
): Promise<AIReviewResult> {
  const startedAt = Date.now()
  options.signal?.throwIfAborted()
  options.onProgress?.('parsing', 10)
  const parsed = parseUnifiedDiff(diff, { maxBytes: options.maxBytes })
  options.signal?.throwIfAborted()
  options.onProgress?.('local-review', 30)
  const local = runLocalRules(parsed)
  const plan = createReviewChunkPlan(parsed, {
    maxPromptCharacters: options.maxPromptCharacters,
  })
  const fallbackChunk = plan.chunks[0]
  if (!fallbackChunk) {
    return {
      ...local,
      warnings: [
        ...local.warnings,
        `AI 审查预算不足，未覆盖任何分块：0/${plan.totalChunks}。本地规则结果仍然有效。`,
      ],
      ai: {
        provider: provider.name,
        model: provider.model,
        durationMs: Date.now() - startedAt,
        confidence: 0,
        repairAttempted: false,
        coverage: {
          truncated: true,
          reviewedFiles: [],
          skippedFiles: plan.skippedFiles,
          reviewedChunks: 0,
          totalChunks: plan.totalChunks,
          omittedCharacters: plan.omittedCharacters,
        },
      },
    }
  }
  const input: AICompletionInput = {
    messages: buildMessages(parsed, plan.chunks, local.risks),
    fallbackFile: fallbackChunk.file,
    fallbackLine: fallbackChunk.newLines[0] ?? 1,
    signal: options.signal,
  }
  options.signal?.throwIfAborted()
  options.onProgress?.('ai-review', 55)
  const { output, model, repairAttempted } = await getValidatedOutput(provider, input)
  options.signal?.throwIfAborted()
  const lineMap = validLinesByFile(plan.chunks)
  const validAIRisks = output.risks.filter((risk) => lineMap.get(risk.file)?.has(risk.line))
  const rejectedCount = output.risks.length - validAIRisks.length
  const aiRisks: ReviewRisk[] = validAIRisks.map((risk, index) => ({
    ...risk,
    id: `ai-${index + 1}`,
    source: 'ai',
    sources: ['ai'],
    ruleId: 'ai-review',
  }))
  const risks = mergeRisks(local.risks, aiRisks)
  const coverageWarning = plan.truncated
    ? `AI 审查因预算限制未覆盖全部分块：${plan.chunks.length}/${plan.totalChunks}。`
    : null
  const evidenceWarning = rejectedCount
    ? `已过滤 ${rejectedCount} 条引用不存在文件或无效新文件行号的 AI 风险。`
    : null

  return {
    ...local,
    summary: output.summary,
    overallRisk: severityMax(risks, 'low'),
    risks,
    testSuggestions: [...new Set([...local.testSuggestions, ...output.testSuggestions])],
    releaseChecklist: [...new Set([...local.releaseChecklist, ...output.releaseChecklist])],
    warnings: [
      ...local.warnings,
      ...(coverageWarning ? [coverageWarning] : []),
      ...(evidenceWarning ? [evidenceWarning] : []),
    ],
    analyzedAt: new Date().toISOString(),
    ai: {
      provider: provider.name,
      model,
      durationMs: Date.now() - startedAt,
      confidence: output.confidence,
      repairAttempted,
      coverage: {
        truncated: plan.truncated,
        reviewedFiles: plan.reviewedFiles,
        skippedFiles: plan.skippedFiles,
        reviewedChunks: plan.chunks.length,
        totalChunks: plan.totalChunks,
        omittedCharacters: plan.omittedCharacters,
      },
    },
  }
}
