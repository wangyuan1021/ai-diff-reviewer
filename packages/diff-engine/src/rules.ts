import type {
  ChangedFile,
  LocalReviewResult,
  ParsedDiff,
  ReviewRisk,
  RiskCategory,
  RiskSeverity,
} from '@ai-diff-reviewer/shared'

interface RiskInput {
  severity: RiskSeverity
  category: RiskCategory
  title: string
  file: string
  line?: number
  evidence: string
  impact: string
  suggestion: string
  ruleId: string
}

const TEST_FILE_PATTERN = /(^|\/)(__tests__|tests?|spec)(\/|\.)|\.(test|spec)\.[cm]?[jt]sx?$/i
const SOURCE_FILE_PATTERN = /\.(vue|[cm]?[jt]sx?|py|go|java|kt|rs|php|rb)$/i
const CONFIG_FILE_PATTERN = /(^|\/)(\.env|config|configs)(\.|\/)|\.(ya?ml|toml|ini)$/i
const DEPENDENCY_FILE_PATTERN =
  /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|pom\.xml|go\.mod|requirements[^/]*\.txt)$/i
const MIGRATION_PATTERN = /(^|\/)(migrations?|database\/migrations?)(\/|$)/i
const AUTH_PATH_PATTERN =
  /(^|\/)(auth|authentication|authorization|permission|permissions|rbac|acl)(\/|\.|$)/i
const PUBLIC_API_PATTERN = /(^|\/)(api|routes?|types?|index)(\/|\.|$)|\.d\.ts$/i

function addedLines(file: ChangedFile) {
  return file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.type === 'add'))
}

function deletedLines(file: ChangedFile) {
  return file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.type === 'delete'))
}

function overallRisk(risks: ReviewRisk[]): RiskSeverity {
  const weight: Record<RiskSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 }
  return risks.reduce<RiskSeverity>(
    (highest, risk) => (weight[risk.severity] > weight[highest] ? risk.severity : highest),
    'low',
  )
}

export function runLocalRules(parsed: ParsedDiff): LocalReviewResult {
  const risks: ReviewRisk[] = []
  let sequence = 0

  const addRisk = (risk: RiskInput) => {
    sequence += 1
    risks.push({ ...risk, id: `local-${sequence}`, source: 'local-rule' })
  }

  for (const file of parsed.files) {
    const added = addedLines(file)
    const deleted = deletedLines(file)

    if (DEPENDENCY_FILE_PATTERN.test(file.path)) {
      addRisk({
        severity: 'medium',
        category: 'dependency',
        title: '依赖清单发生变化',
        file: file.path,
        evidence: '检测到依赖描述文件或锁文件变更。',
        impact: '依赖升级可能引入兼容性、安全性或构建结果变化。',
        suggestion: '核对依赖变更原因，执行完整安装、构建和依赖安全检查。',
        ruleId: 'dependency-change',
      })
    }

    if (CONFIG_FILE_PATTERN.test(file.path)) {
      addRisk({
        severity: 'medium',
        category: 'configuration',
        title: '运行配置发生变化',
        file: file.path,
        evidence: '检测到环境或配置类文件变更。',
        impact: '配置差异可能导致环境间行为不一致或发布失败。',
        suggestion: '核对各环境配置，并确认默认值、回滚方案和发布说明。',
        ruleId: 'configuration-change',
      })
    }

    if (MIGRATION_PATTERN.test(file.path)) {
      addRisk({
        severity: 'high',
        category: 'compatibility',
        title: '数据库迁移需要发布校验',
        file: file.path,
        evidence: '检测到数据库迁移目录中的文件变更。',
        impact: '不可逆或耗时迁移可能造成数据损坏、锁表或服务中断。',
        suggestion: '验证向前与回滚脚本，在接近生产数据量的环境执行演练。',
        ruleId: 'database-migration',
      })
    }

    if (AUTH_PATH_PATTERN.test(file.path)) {
      addRisk({
        severity: 'high',
        category: 'security',
        title: '认证或权限逻辑发生变化',
        file: file.path,
        evidence: '文件路径表明该变更涉及认证、授权或权限控制。',
        impact: '错误的权限判断可能导致越权访问或正常用户无法操作。',
        suggestion: '补充未登录、低权限、跨用户和管理员场景的权限测试。',
        ruleId: 'auth-change',
      })
    }

    for (const line of added) {
      const content = line.content
      if (/\beval\s*\(|new\s+Function\s*\(/.test(content)) {
        addRisk({
          severity: 'critical',
          category: 'security',
          title: '检测到动态代码执行',
          file: file.path,
          line: line.newLine,
          evidence: '新增代码使用了 eval 或 Function 构造器。',
          impact: '未经严格约束的输入可能被执行为任意代码。',
          suggestion: '移除动态执行；如无法移除，使用白名单解析并隔离不可信输入。',
          ruleId: 'dynamic-code-execution',
        })
      }

      if (
        /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][^'"${}]{8,}['"]/i.test(content)
      ) {
        addRisk({
          severity: 'critical',
          category: 'security',
          title: '疑似硬编码敏感信息',
          file: file.path,
          line: line.newLine,
          evidence: '新增行疑似包含直接写入代码的密钥、令牌或密码，内容已隐藏。',
          impact: '敏感凭据可能随代码库、构建产物或日志泄露。',
          suggestion: '立即移除并轮换凭据，改用环境变量或密钥管理服务。',
          ruleId: 'hardcoded-secret',
        })
      }

      if (/\b(TODO|FIXME)\b/.test(content)) {
        addRisk({
          severity: 'low',
          category: 'maintainability',
          title: '新增未完成标记',
          file: file.path,
          line: line.newLine,
          evidence: content.trim().slice(0, 160),
          impact: '未完成逻辑若缺少跟踪，可能长期遗留或影响上线质量。',
          suggestion: '确认是否阻塞发布，并关联可追踪的任务编号。',
          ruleId: 'unfinished-marker',
        })
      }

      if (/\bconsole\.(log|debug|info)\s*\(/.test(content)) {
        addRisk({
          severity: 'low',
          category: 'maintainability',
          title: '新增调试输出',
          file: file.path,
          line: line.newLine,
          evidence: content.trim().slice(0, 160),
          impact: '调试输出可能污染生产日志，或意外记录用户与业务数据。',
          suggestion: '删除调试输出或替换为经过脱敏和分级的日志。',
          ruleId: 'debug-output',
        })
      }
    }

    const deletedErrorHandling = deleted.find((line) =>
      /\b(catch|try|finally|throw|onError|errorHandler)\b/.test(line.content),
    )
    if (deletedErrorHandling) {
      addRisk({
        severity: 'high',
        category: 'correctness',
        title: '异常处理代码被删除',
        file: file.path,
        line: deletedErrorHandling.oldLine,
        evidence: deletedErrorHandling.content.trim().slice(0, 160),
        impact: '异常可能失去兜底处理，造成未捕获错误或错误状态未清理。',
        suggestion: '确认替代处理链路，并补充失败、超时和资源清理测试。',
        ruleId: 'removed-error-handling',
      })
    }

    if (file.additions + file.deletions >= 400) {
      addRisk({
        severity: 'medium',
        category: 'maintainability',
        title: '单文件变更规模较大',
        file: file.path,
        evidence: `该文件新增 ${file.additions} 行、删除 ${file.deletions} 行。`,
        impact: '大规模变更增加人工审查难度，也更容易隐藏回归。',
        suggestion: '考虑拆分提交，并重点执行该模块的回归测试。',
        ruleId: 'large-file-change',
      })
    }

    if (PUBLIC_API_PATTERN.test(file.path) && SOURCE_FILE_PATTERN.test(file.path)) {
      addRisk({
        severity: 'medium',
        category: 'compatibility',
        title: '公共接口或类型可能发生变化',
        file: file.path,
        evidence: '变更文件位于 API、路由、类型声明或公共导出位置。',
        impact: '调用方可能因参数、返回值或导出变化而不兼容。',
        suggestion: '核对调用方，补充契约测试并在发布说明中记录兼容性影响。',
        ruleId: 'public-api-change',
      })
    }
  }

  const sourceChanged = parsed.files.some(
    (file) => SOURCE_FILE_PATTERN.test(file.path) && !TEST_FILE_PATTERN.test(file.path),
  )
  const testChanged = parsed.files.some((file) => TEST_FILE_PATTERN.test(file.path))
  if (sourceChanged && !testChanged) {
    const sourceFile = parsed.files.find(
      (file) => SOURCE_FILE_PATTERN.test(file.path) && !TEST_FILE_PATTERN.test(file.path),
    )
    if (sourceFile) {
      addRisk({
        severity: 'medium',
        category: 'testing',
        title: '业务代码变化但未发现测试变更',
        file: sourceFile.path,
        evidence: '本次 Diff 包含源码变更，但没有测试文件变更。',
        impact: '新行为或回归缺少自动化验证证据。',
        suggestion: '补充核心路径、边界条件和失败场景测试，或说明现有测试覆盖依据。',
        ruleId: 'missing-test-change',
      })
    }
  }

  const hasDependencyChange = risks.some((risk) => risk.ruleId === 'dependency-change')
  const hasMigration = risks.some((risk) => risk.ruleId === 'database-migration')
  const hasConfigChange = risks.some((risk) => risk.ruleId === 'configuration-change')

  return {
    summary: `分析了 ${parsed.statistics.filesChanged} 个文件，共 ${parsed.statistics.totalChangedLines} 行变更，发现 ${risks.length} 项需关注内容。`,
    overallRisk: overallRisk(risks),
    changedFiles: parsed.files,
    statistics: parsed.statistics,
    risks,
    testSuggestions: sourceChanged
      ? ['执行受影响模块的单元测试和集成测试。', '覆盖成功、失败、边界值和回滚场景。']
      : ['确认文档或配置变更无需新增自动化测试。'],
    releaseChecklist: [
      '确认代码审查结论已处理或记录接受风险。',
      ...(hasDependencyChange ? ['重新安装依赖并执行依赖安全检查。'] : []),
      ...(hasConfigChange ? ['核对测试、预发与生产环境配置差异。'] : []),
      ...(hasMigration ? ['在预发环境完成数据库迁移与回滚演练。'] : []),
      '执行构建和核心回归测试，并准备回滚方案。',
    ],
    warnings: parsed.warnings,
    analyzedAt: new Date().toISOString(),
  }
}
