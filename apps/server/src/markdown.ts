import type { ReviewHistoryDetail, ReviewRisk } from '@ai-diff-reviewer/shared'

function inline(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replaceAll('|', '\\|')
    .trim()
}

function riskSection(risk: ReviewRisk, index: number): string {
  const location = `${inline(risk.file)}${risk.line ? `:${risk.line}` : ''}`
  return [
    `### ${index + 1}. ${inline(risk.title)}`,
    '',
    `- 严重等级：${risk.severity}`,
    `- 类别：${risk.category}`,
    `- 位置：${location}`,
    `- 来源：${risk.source}`,
    `- 证据：${inline(risk.evidence)}`,
    `- 影响：${inline(risk.impact)}`,
    `- 建议：${inline(risk.suggestion)}`,
  ].join('\n')
}

export function reviewToMarkdown(review: ReviewHistoryDetail): string {
  const { result, statistics } = review
  const provider = review.provider
    ? `\n- AI Provider：${review.provider} / ${inline(review.model ?? 'unknown')}`
    : ''
  const risks = result.risks.length
    ? result.risks.map(riskSection).join('\n\n')
    : '本次结构化审查未发现明显风险，仍建议完成人工复核。'
  const tests = result.testSuggestions.map((item) => `- [ ] ${inline(item)}`).join('\n') || '- 无'
  const release =
    result.releaseChecklist.map((item) => `- [ ] ${inline(item)}`).join('\n') || '- 无'
  const files = result.changedFiles
    .map((file) => `- \`${inline(file.path)}\`（+${file.additions} / -${file.deletions}）`)
    .join('\n')

  return `# AI Diff Review 报告

- 审查 ID：${review.id}
- Diff SHA-256：${review.diffHash}
- 模式：${review.mode}${provider}
- 完成时间：${review.completedAt}
- 总体等级：${result.overallRisk}
- 文件数：${statistics.filesChanged}
- 新增 / 删除：+${statistics.additions} / -${statistics.deletions}
- 风险数：${review.riskCount}

## 摘要

${inline(result.summary)}

## 风险证据

${risks}

## 变更文件

${files || '- 无'}

## 测试建议

${tests}

## 发布检查

${release}

> 为保护隐私，本报告不包含原始 Diff 或 hunk 内容。
`
}
