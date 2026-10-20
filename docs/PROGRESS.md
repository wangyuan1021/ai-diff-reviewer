# AI Diff Reviewer 开发交接记录

本文档用于跨对话、跨开发日继续项目。开始新一轮开发前，请先阅读本文档和根目录 `README.md`，再检查当前 Git 状态与测试结果。

## 项目概况

- 项目名称：AI Diff Reviewer
- 项目路径：仓库根目录
- GitHub 仓库：以当前项目的 `origin` remote 为准
- 当前分支：`main`
- 当前阶段：Day 02 已完成，待开始 Day 03
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

## Day 02 完成内容

已完成可替换的 AI Provider 和证据化结构化审查，同时保持无 API Key 也能开发、测试和演示。

### 共享数据模型

- 定义 Provider、配置、模型输出、联合审查结果、覆盖状态和 Provider 错误类型。
- 结果包含摘要、总体等级、置信度、测试建议、发布检查和截断状态。
- 服务端使用严格 Zod Schema，限制枚举、文本长度、数组长度和最多 20 条风险。

### Provider 适配层

- `MockProvider` 提供固定、可重复且引用真实 Diff 行号的响应。
- `OpenAICompatibleProvider` 支持可配置 Base URL、模型和 API Key，使用 Chat Completions JSON 模式。
- `OllamaProvider` 使用本地非流式 Chat API；不可用时返回明确网络或上游错误。
- 支持 `AI_PROVIDER`、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS`、`AI_MAX_PROMPT_CHARACTERS`。

### 证据化 AI 审查

- Prompt 只包含统计、文件列表、本地规则证据和选中的 Diff 分块。
- 只接受严格 JSON；文件必须来自当前 Diff，行号必须出现在已审查分块的新文件行范围内。
- 不存在的文件和无效行号会被过滤并形成警告。
- 格式错误允许一次修复尝试，仍失败则返回 `AI_RESPONSE_INVALID`。
- 本地与 AI 重复风险会合并，并保留 `local-rule`、`ai` 或 `combined` 来源。

### 大 Diff 基础分块

- 已按文件与 hunk 生成分块，单个超大 hunk 会继续按行切分。
- 配置、依赖、权限和迁移文件优先进入预算。
- 超预算会返回已审查/总分块、已审查/跳过文件和省略字符数，页面明确显示截断。
- 当前保持非流式请求；SSE、取消和任务状态归 Day 03。

### API 与页面

- 新增 `POST /api/reviews/ai`，保留 `POST /api/reviews/local`。
- 页面可选择本地规则、Mock、OpenAI-compatible 或 Ollama。
- 页面展示 Provider、模型、耗时、置信度、覆盖/截断状态和风险来源。
- Provider 未配置、超时、网络错误、上游错误和响应非法均为可理解的结构化错误。

## Day 02 验证证据

- TypeScript：4 个 workspace 包通过。
- Vitest/Supertest：6 个测试文件、24 项测试全部通过。
- 覆盖 OpenAI-compatible 与 Ollama 请求协议、缺少配置、网络失败、超时、非法 JSON、Schema 错误、一次修复、伪造文件、无效行号和截断状态。
- ESLint、4 个 workspace 包 TypeScript 检查、服务端与 Web 生产构建全部通过。
- 浏览器实测：Mock 模式分析虚构样例，展示 6 条本地风险、1 条 AI 风险、2/2 分块覆盖，控制台无 error 或 warning。

## Day 02 验收结果

- [x] Mock 模式无需 API Key，可从页面完成结构化 AI 审查。
- [x] OpenAI-compatible 与 Ollama 均已实现并有 HTTP 协议 Mock 测试。
- [x] AI 风险包含等级、类别、文件、行号、证据、影响、建议和来源。
- [x] 不存在的文件路径和无效行号会被过滤并报告。
- [x] 非法 JSON、Schema 错误、超时和网络失败均有自动化测试。
- [x] 普通日志不记录 API Key 或完整原始 Diff。
- [x] `pnpm check` 全部通过。

## Day 03 起点

- 引入异步审查任务状态，支持 SSE 进度、客户端取消和端到端超时。
- 使用 SQLite 保存 Diff 哈希、统计、结构化结果和 Provider 元数据，不保存原始 Diff。
- 增加历史列表、详情和 Markdown 导出。

## 后续范围

- Day 04：敏感信息检测与脱敏、10～20 个可重复评测样本、评测报告。
- Day 05：补齐测试、Docker、GitHub Actions、架构图、截图和作品说明。

## 新对话开场语

```text
继续开发当前 AI Diff Reviewer 仓库。
请先阅读 README.md 和 docs/PROGRESS.md，检查 Git 状态并运行现有测试，然后按 Day 03 计划完成 SSE、取消、任务状态、SQLite 历史记录和 Markdown 导出。不要使用或引入任何公司代码和敏感信息。
```

## Git 注意事项

- 提交前确认 `git status`，不得提交 `.env`、API Key、原始公司 Diff、内部地址、`node_modules`、`.pnpm-store` 或构建产物。
