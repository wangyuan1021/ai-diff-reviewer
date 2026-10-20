# AI Diff Reviewer 开发交接记录

本文档用于跨对话、跨开发日继续项目。开始新一轮开发前，请先阅读本文档和根目录 `README.md`，再检查当前 Git 状态与测试结果。

## 项目概况

- 项目名称：AI Diff Reviewer
- 项目路径：仓库根目录
- GitHub 仓库：以当前项目的 `origin` remote 为准
- 当前分支：`main`
- 当前阶段：Day 01 已完成，待开始 Day 02
- 最近完成提交：`3f9537a feat: complete day one local diff reviewer`
- 隐私要求：不得使用公司代码、业务名称、内部域名、接口地址、凭据或其他敏感信息；样例只使用虚构内容或公开开源内容。

## 五天目标

交付一个可运行、可演示、可评测、隐私优先的 Git Diff 风险分析工具：本地规则与大模型共同分析变更，每条风险提供文件、行号、证据、影响和修改建议，并具备流式进度、任务取消、历史记录、脱敏、评测、测试和部署说明。

## 当前工程结构

```text
ai-diff-reviewer/
├── apps/
│   ├── server/               # Koa API
│   └── web/                  # Vue 3 工作台
├── packages/
│   ├── diff-engine/          # Diff 解析与本地规则引擎
│   └── shared/               # 前后端共享类型
├── samples/                  # 虚构 Diff 样例
├── docs/                     # 项目进度与后续文档
├── .env.example
├── package.json
└── pnpm-workspace.yaml
```

## Day 01 完成内容

### 工程基础

- 建立 pnpm workspace，包含 Vue Web、Koa Server、共享类型和 Diff 引擎。
- 配置 TypeScript 严格模式、ESLint、Prettier、Vitest、Supertest 和 tsup。
- 提供 `.env.example`、`.gitignore`、基础 README 和统一检查命令。
- 初始化本地 Git 仓库并推送至 GitHub `main` 分支。

### Diff 解析

- 支持粘贴 Unified Diff。
- 支持上传 `.diff`、`.patch` 和 `.txt` 文件。
- 支持新增、修改、删除、重命名文件识别。
- 解析文件路径、hunk、新旧行号和上下文行。
- 统计文件数、新增行、删除行和总变更行数。
- 拒绝空内容、非 Unified Diff 和超过默认 512 KiB 的内容。

### 本地风险规则

目前覆盖：

- 依赖清单或锁文件变化。
- 环境与运行配置变化。
- 数据库迁移变化。
- 认证、授权和权限模块变化。
- `eval` 或 `Function` 动态代码执行。
- 疑似硬编码密钥、令牌或密码，证据中不回显敏感值。
- 新增 `TODO`、`FIXME`。
- 新增 `console.log/debug/info`。
- 删除异常处理代码。
- 单文件变更规模过大。
- 公共 API、路由、类型或导出变化。
- 源码变化但未发现测试文件变化。

### API 与页面

- `GET /api/health`：服务健康检查。
- `POST /api/reviews/local`：执行解析和本地规则审查。
- Web 页面展示变更统计、总体等级、风险证据、影响、建议、测试建议和发布检查。
- 页面明确提示当前阶段不向外部模型发送代码、不持久化原始 Diff。

## Day 01 验证证据

最后一次全量检查结果：

- ESLint：通过，零错误。
- TypeScript：4 个 workspace 包全部通过。
- Vitest/Supertest：3 个测试文件、8 项测试全部通过。
- Build：共享包、Diff 引擎、Koa Server 和 Vue Web 全部构建成功。
- 浏览器实测：虚构样例识别 2 个文件、4 行新增、5 行删除和 6 项风险。
- 浏览器控制台：无 error 或 warning。

重新验证：

```bash
pnpm check
```

本地运行：

```bash
pnpm install
pnpm dev
```

- Web：<http://localhost:5173>
- API：<http://localhost:3000/api/health>

## 已确定的技术决策

1. 原始 Diff 默认不落库，历史记录只保存哈希、统计和结构化结果。
2. AI 输出必须经过 Zod 校验，不能直接把自由文本当成可信结果。
3. 每条 AI 风险必须引用本次 Diff 中真实存在的文件和有效行号。
4. 本地规则与 AI 使用相同的 `ReviewRisk` 结构，并通过 `source` 区分来源。
5. 大 Diff 后续按文件和 hunk 分块，不能简单截断后伪装为完整审查。
6. 开发与测试必须支持 Mock Provider，不能把 API Key 作为启动前提。
7. 模型配置只从环境变量读取，不进入 Git、数据库或普通日志。
8. 五天 MVP 不接 GitHub App，不自动向 Pull Request 发布评论。

## Day 02 执行计划

目标：完成可替换的 AI Provider 和证据化结构化审查，同时保持无 API Key 也能开发、测试和演示。

### 1. 扩展共享数据模型

- 定义 `AIProvider`、模型配置、审查输入、结构化输出和 Provider 错误类型。
- 补充总体摘要、置信度、测试建议、发布检查和截断状态。
- 为模型结果定义严格 Zod Schema，并限制枚举、文本长度和风险数量。

### 2. 实现 Provider 适配层

- `MockProvider`：固定且可重复的结构化响应，用于自动化测试和无 Key 演示。
- `OpenAICompatibleProvider`：支持可配置的 Base URL、模型和 API Key。
- `OllamaProvider`：使用本地 Ollama HTTP API；没有本地模型时给出明确错误。
- 配置项：`AI_PROVIDER`、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS`。

### 3. 实现证据化 AI 审查

- Prompt 只包含必要的统计、文件列表、分块 Diff 和本地规则结果。
- 要求返回严格 JSON，不接受 Markdown 包裹或泛泛总结。
- 校验文件路径必须来自当前 Diff。
- 校验新文件行号必须出现在对应新增或上下文行范围内。
- 对格式错误允许一次修复尝试，仍失败则返回结构化错误。
- 合并本地规则和 AI 的重复风险，保留来源信息。

### 4. 大 Diff 基础分块

- 按文件与 hunk 生成审查分块。
- 配置、依赖、权限和迁移文件优先。
- 超过预算时明确标记未审查部分，禁止静默丢弃。
- Day 02 先完成非流式调用；SSE、取消和超时任务状态归 Day 03。

### 5. API 与页面

- 新增 AI 审查接口，保留现有本地规则接口。
- 页面允许选择 Mock、OpenAI-compatible 或 Ollama 模式。
- 展示 Provider、模型、耗时、截断状态和 AI/本地规则来源。
- Provider 未配置或响应非法时显示可理解错误，不导致服务崩溃。

## Day 02 验收标准

- Mock 模式无需 API Key，可以从页面完成一次结构化 AI 审查。
- 至少一种真实 Provider 的实现完成；没有可用凭据时用 HTTP Mock 测试请求协议。
- AI 风险均包含等级、类别、文件、证据、影响、建议和来源。
- 不存在的文件路径和无效行号会被拒绝或过滤。
- 模型非法 JSON、Schema 错误、超时和网络失败均有自动化测试。
- 普通日志中不出现 API Key 或完整原始 Diff。
- `pnpm check` 全部通过。

## 后续范围

- Day 03：SSE、任务状态、取消、超时、SQLite 历史记录、Markdown 导出。
- Day 04：敏感信息检测与脱敏、10～20 个可重复评测样本、评测报告。
- Day 05：补齐测试、Docker、GitHub Actions、架构图、截图和作品说明。

## 新对话开场语

```text
继续开发当前 AI Diff Reviewer 仓库。
请先阅读 README.md 和 docs/PROGRESS.md，检查 Git 状态并运行现有测试，然后按 Day 02 计划完成 AI Provider、结构化输出校验和证据化审查。不要使用或引入任何公司代码和敏感信息。
```

## Git 注意事项

- 提交前确认 `git status`，不得提交 `.env`、API Key、原始公司 Diff、内部地址、`node_modules`、`.pnpm-store` 或构建产物。
