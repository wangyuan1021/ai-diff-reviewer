import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format } from 'prettier'
import {
  parseUnifiedDiff,
  redactParsedDiff,
  runLocalRules,
} from '../packages/diff-engine/src/index'
import type { SensitiveDataKind } from '../packages/shared/src/index'

const prettierOptions = { printWidth: 100, proseWrap: 'preserve' as const }

interface EvaluationCase {
  id: string
  expectedRuleIds: string[]
  expectedSensitiveTypes: SensitiveDataKind[]
}

interface CaseResult extends EvaluationCase {
  actualRuleIds: string[]
  actualSensitiveTypes: SensitiveDataKind[]
  missingRuleIds: string[]
  unexpectedRuleIds: string[]
  missingSensitiveTypes: SensitiveDataKind[]
  passed: boolean
}

const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, 'evaluation/manifest.json')
const cases = JSON.parse(readFileSync(manifestPath, 'utf8')) as EvaluationCase[]

function difference<T>(left: T[], right: T[]): T[] {
  const rightSet = new Set(right)
  return left.filter((item) => !rightSet.has(item))
}

const results: CaseResult[] = cases.map((item) => {
  const diff = readFileSync(resolve(root, `evaluation/cases/${item.id}.diff`), 'utf8')
  const parsed = parseUnifiedDiff(diff)
  const review = runLocalRules(parsed)
  const redaction = redactParsedDiff(parsed)
  const actualRuleIds = [...new Set(review.risks.map((risk) => risk.ruleId))].sort()
  const actualSensitiveTypes = redaction.summary.types
  const missingRuleIds = difference(item.expectedRuleIds, actualRuleIds)
  const unexpectedRuleIds = difference(actualRuleIds, item.expectedRuleIds)
  const missingSensitiveTypes = difference(item.expectedSensitiveTypes, actualSensitiveTypes)
  return {
    ...item,
    actualRuleIds,
    actualSensitiveTypes,
    missingRuleIds,
    unexpectedRuleIds,
    missingSensitiveTypes,
    passed:
      missingRuleIds.length === 0 &&
      unexpectedRuleIds.length === 0 &&
      missingSensitiveTypes.length === 0,
  }
})

const expectedRuleCount = results.reduce((sum, item) => sum + item.expectedRuleIds.length, 0)
const matchedRuleCount = results.reduce(
  (sum, item) => sum + item.expectedRuleIds.length - item.missingRuleIds.length,
  0,
)
const expectedSensitiveCount = results.reduce(
  (sum, item) => sum + item.expectedSensitiveTypes.length,
  0,
)
const matchedSensitiveCount = results.reduce(
  (sum, item) => sum + item.expectedSensitiveTypes.length - item.missingSensitiveTypes.length,
  0,
)
const unexpectedRuleCount = results.reduce((sum, item) => sum + item.unexpectedRuleIds.length, 0)
const passedCases = results.filter((item) => item.passed).length
const percentage = (matched: number, total: number) =>
  total === 0 ? '100.0%' : `${((matched / total) * 100).toFixed(1)}%`
const display = (values: string[]) =>
  values.length ? values.map((value) => `\`${value}\``).join(', ') : '—'

const report = `# Day 04 可重复评测报告

> 由 \`pnpm eval\` 从完全虚构的 Unified Diff 样本确定性生成；不调用外部模型。

## 汇总

| 指标 | 结果 |
| --- | ---: |
| 样本通过率 | ${passedCases}/${results.length}（${percentage(passedCases, results.length)}） |
| 预期规则召回 | ${matchedRuleCount}/${expectedRuleCount}（${percentage(matchedRuleCount, expectedRuleCount)}） |
| 敏感类型召回 | ${matchedSensitiveCount}/${expectedSensitiveCount}（${percentage(matchedSensitiveCount, expectedSensitiveCount)}） |
| 意外规则命中 | ${unexpectedRuleCount} |

## 样本明细

| 样本 | 状态 | 预期规则 | 实际规则 | 脱敏类型 |
| --- | --- | --- | --- | --- |
${results
  .map(
    (item) =>
      `| ${item.id} | ${item.passed ? '通过' : '失败'} | ${display(item.expectedRuleIds)} | ${display(item.actualRuleIds)} | ${display(item.actualSensitiveTypes)} |`,
  )
  .join('\n')}

## 失败详情

${
  results
    .filter((item) => !item.passed)
    .map(
      (item) =>
        `- \`${item.id}\`：缺失规则 ${display(item.missingRuleIds)}；意外规则 ${display(item.unexpectedRuleIds)}；缺失脱敏类型 ${display(item.missingSensitiveTypes)}。`,
    )
    .join('\n') || '- 无。'
}

## 评测边界

- 规则评测要求每个样本的规则集合与清单完全一致，用于发现漏报和新增误报。
- 脱敏评测要求所有声明的敏感类型均被识别；值是否彻底移除由自动化单元测试覆盖。
- 本报告评测本地规则和 Prompt 脱敏，不把 Mock Provider 输出质量计入指标。
`

const jsonReport = {
  summary: {
    cases: results.length,
    passedCases,
    expectedRuleCount,
    matchedRuleCount,
    expectedSensitiveCount,
    matchedSensitiveCount,
    unexpectedRuleCount,
  },
  results,
}

writeFileSync(
  resolve(root, 'docs/EVALUATION.md'),
  await format(report, { ...prettierOptions, parser: 'markdown' }),
)
writeFileSync(
  resolve(root, 'docs/evaluation-results.json'),
  await format(JSON.stringify(jsonReport), { ...prettierOptions, parser: 'json' }),
)

console.log(
  `评测完成：${passedCases}/${results.length} 样本通过，规则召回 ${percentage(matchedRuleCount, expectedRuleCount)}，敏感类型召回 ${percentage(matchedSensitiveCount, expectedSensitiveCount)}。`,
)

if (passedCases !== results.length) process.exitCode = 1
