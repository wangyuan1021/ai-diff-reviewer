import type { AIModelOutput } from '@ai-diff-reviewer/shared'
import { describe, expect, it } from 'vitest'
import type { AICompletionInput, AICompletionResult, AIProvider } from './providers'
import { reviewDiffWithAI } from './review'

const diff = `diff --git a/src/access.ts b/src/access.ts
--- a/src/access.ts
+++ b/src/access.ts
@@ -1,2 +1,3 @@
 export function canAccess(role: string) {
+  console.log(role)
   return role === 'admin'
 }
`

function output(overrides: Partial<AIModelOutput> = {}): AIModelOutput {
  return {
    summary: '结构化审查完成。',
    overallRisk: 'medium',
    confidence: 0.8,
    risks: [
      {
        severity: 'medium',
        category: 'correctness',
        title: '权限分支需要更多验证',
        file: 'FILE_001',
        line: 2,
        evidence: '新增行输出角色信息。',
        impact: '可能暴露不必要的信息。',
        suggestion: '删除输出并增加权限分支测试。',
      },
    ],
    testSuggestions: ['覆盖普通用户与管理员。'],
    releaseChecklist: ['确认日志不包含用户数据。'],
    ...overrides,
  }
}

class SequenceProvider implements AIProvider {
  readonly name = 'mock' as const
  readonly model = 'sequence-model'
  calls: AICompletionInput[] = []

  constructor(private readonly responses: string[]) {}

  async complete(input: AICompletionInput): Promise<AICompletionResult> {
    this.calls.push(input)
    return {
      content: this.responses[this.calls.length - 1] ?? this.responses.at(-1) ?? '',
      model: this.model,
    }
  }
}

const options = { maxBytes: 512 * 1024, maxPromptCharacters: 60_000 }

describe('reviewDiffWithAI', () => {
  it('merges evidence-backed AI risks with local results', async () => {
    const provider = new SequenceProvider([JSON.stringify(output())])

    const result = await reviewDiffWithAI(diff, provider, options)

    expect(result.ai.provider).toBe('mock')
    expect(result.ai.confidence).toBe(0.8)
    expect(result.risks.some((risk) => risk.source === 'ai')).toBe(true)
    expect(result.risks.every((risk) => risk.sources.length > 0)).toBe(true)
    expect(provider.calls[0]?.messages[1]?.content).toContain('FILE FILE_001')
    expect(provider.calls[0]?.messages[1]?.content).not.toContain('src/access.ts')
  })

  it('only merges risks that describe the same issue', async () => {
    const duplicateDebugRisk = output({
      risks: [
        {
          severity: 'low',
          category: 'maintainability',
          title: '新增调试输出',
          file: 'FILE_001',
          line: 2,
          evidence: 'AI 也识别到新增调试输出。',
          impact: '可能记录不必要的信息。',
          suggestion: '移除调试输出。',
        },
        output().risks[0]!,
      ],
    })

    const result = await reviewDiffWithAI(
      diff,
      new SequenceProvider([JSON.stringify(duplicateDebugRisk)]),
      options,
    )

    const debugRisks = result.risks.filter((risk) => risk.title === '新增调试输出')
    expect(debugRisks).toHaveLength(1)
    expect(debugRisks[0]?.source).toBe('combined')
    expect(result.risks.find((risk) => risk.title === '权限分支需要更多验证')?.source).toBe('ai')
  })

  it('filters nonexistent files and invalid new-file line numbers', async () => {
    const invalidRisks = output({
      risks: [
        { ...output().risks[0]!, file: 'src/not-in-diff.ts' },
        { ...output().risks[0]!, line: 999 },
      ],
    })
    const result = await reviewDiffWithAI(
      diff,
      new SequenceProvider([JSON.stringify(invalidRisks)]),
      options,
    )

    expect(result.risks.some((risk) => risk.source === 'ai')).toBe(false)
    expect(result.warnings).toContain('已过滤 2 条引用不存在文件或无效新文件行号的 AI 风险。')
  })

  it('redacts secrets and private identifiers before calling a provider', async () => {
    const sensitiveDiff = `diff --git a/src/internal/client.ts b/src/internal/client.ts
--- a/src/internal/client.ts
+++ b/src/internal/client.ts
@@ -0,0 +1,3 @@
+const password = "fictional-secret-value"
+const owner = "demo.person@example.test"
+const host = "192.168.10.24"
`
    const provider = new SequenceProvider([JSON.stringify(output({ risks: [] }))])

    const result = await reviewDiffWithAI(sensitiveDiff, provider, options)
    const prompt = provider.calls[0]?.messages.map((message) => message.content).join('\n') ?? ''

    expect(prompt).not.toContain('fictional-secret-value')
    expect(prompt).not.toContain('demo.person@example.test')
    expect(prompt).not.toContain('192.168.10.24')
    expect(prompt).not.toContain('src/internal/client.ts')
    expect(prompt).toContain('[REDACTED:CREDENTIAL]')
    expect(prompt).toContain('[REDACTED:EMAIL]')
    expect(prompt).toContain('[REDACTED:PRIVATE_IP]')
    expect(result.ai.redaction).toEqual({
      findings: 3,
      types: ['credential', 'email-address', 'private-ip-address'],
      filePathsAliased: true,
    })
    expect(result.risks.some((risk) => risk.ruleId === 'hardcoded-secret')).toBe(true)
    expect(result.risks.some((risk) => risk.ruleId === 'sensitive-personal-data')).toBe(true)
  })

  it('repairs one invalid response', async () => {
    const provider = new SequenceProvider(['not-json', JSON.stringify(output())])

    const result = await reviewDiffWithAI(diff, provider, options)

    expect(result.ai.repairAttempted).toBe(true)
    expect(provider.calls).toHaveLength(2)
    expect(provider.calls[1]?.messages.at(-1)?.content).toContain('不是符合 Schema')
  })

  it('rejects a second invalid response', async () => {
    const provider = new SequenceProvider(['not-json', JSON.stringify({ summary: 'incomplete' })])

    await expect(reviewDiffWithAI(diff, provider, options)).rejects.toMatchObject({
      code: 'AI_RESPONSE_INVALID',
      status: 502,
    })
  })

  it('reports prompt-budget truncation explicitly', async () => {
    const result = await reviewDiffWithAI(
      diff,
      new SequenceProvider([JSON.stringify(output({ risks: [] }))]),
      { ...options, maxPromptCharacters: 120 },
    )

    expect(result.ai.coverage.truncated).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('未覆盖全部分块'))).toBe(true)
  })

  it('keeps local results when no complete chunk fits the budget', async () => {
    const provider = new SequenceProvider([JSON.stringify(output())])

    const result = await reviewDiffWithAI(diff, provider, {
      ...options,
      maxPromptCharacters: 10,
    })

    expect(provider.calls).toHaveLength(0)
    expect(result.ai.confidence).toBe(0)
    expect(result.ai.coverage.reviewedChunks).toBe(0)
    expect(result.ai.coverage.truncated).toBe(true)
    expect(result.risks.some((risk) => risk.source === 'local-rule')).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('未覆盖任何分块'))).toBe(true)
  })
})
