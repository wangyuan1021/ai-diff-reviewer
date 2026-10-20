# AI Diff Reviewer

一个可解释、可评测、隐私优先的 Git Diff 风险分析工具。当前 Day 02 版本支持本地规则、无需密钥的 Mock AI、OpenAI-compatible API 与本地 Ollama，不保存原始 Diff。

当前开发状态、验证证据、技术决策和下一步计划见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

## 当前能力

- 粘贴 Unified Diff，或上传 `.diff`、`.patch`、`.txt` 文件。
- 解析新增、修改、删除、重命名文件及其代码块和行号。
- 统计文件数、新增行、删除行和总变更行数。
- 识别依赖、配置、数据库迁移、认证权限、公共 API 等高影响变更。
- 检查动态代码执行、疑似硬编码密钥、调试输出、未完成标记和异常处理删除。
- 在业务代码变更但没有测试变更时给出提示。
- 返回结构化风险证据、影响、修复建议、测试建议与发布检查表。
- 按文件与 hunk 为 AI 审查生成分块，并优先处理配置、依赖、权限和迁移文件。
- 用严格 Zod Schema 校验模型 JSON，过滤不存在的文件和无效新文件行号。
- 合并本地与 AI 重复风险，展示 Provider、模型、耗时、置信度、来源和覆盖状态。
- 对非法 JSON 自动修复一次，对配置、超时、网络和上游错误返回结构化信息。

## 技术栈

- Vue 3 + TypeScript + Vite
- Node.js + TypeScript + Koa
- pnpm workspace
- Zod、parse-diff、Vitest、Supertest

## 本地启动

需要 Node.js 22+ 与 pnpm 10+。

```bash
pnpm install
pnpm dev
```

- Web：<http://localhost:5173>
- API：<http://localhost:3000/api/health>

页面默认带有一份虚构风险样例，也可以使用 `samples/day-01-risky.diff`。默认选择 Mock AI，不需要 API Key，也不会发起外部模型请求。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

也可以运行全部检查：

```bash
pnpm check
```

## API

### 健康检查

```http
GET /api/health
```

### 本地规则审查

```http
POST /api/reviews/local
Content-Type: application/json

{
  "diff": "diff --git ..."
}
```

### AI 与本地规则联合审查

```http
POST /api/reviews/ai
Content-Type: application/json

{
  "diff": "diff --git ...",
  "provider": "mock"
}
```

`provider` 可选值为 `mock`、`openai-compatible`、`ollama`；省略时使用服务端 `AI_PROVIDER`。模型和凭据只能通过服务端环境变量配置：

```bash
AI_PROVIDER=mock
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_TIMEOUT_MS=30000
AI_MAX_PROMPT_CHARACTERS=60000
```

- OpenAI-compatible：默认 Base URL 为 `https://api.openai.com/v1`，调用 `/chat/completions`。
- Ollama：默认 Base URL 为 `http://localhost:11434`，调用非流式 `/api/chat`。
- 页面只选择 Provider，不接收或保存 API Key。

默认限制为 512 KiB，可通过 `MAX_DIFF_BYTES` 调整。环境变量示例见 `.env.example`。

## 隐私边界

- 本地规则和 Mock 模式不会把 Diff 发送给第三方；选择 OpenAI-compatible 会把必要分块发往已配置服务，Ollama 默认只访问本机服务。
- 当前版本没有数据库，不会持久化原始 Diff 或审查结果。
- 普通日志不记录 API Key、完整原始 Diff 或模型请求正文。
- 风险规则不能替代人工代码审查、安全审计和完整测试。
- 示例均为虚构代码，不包含任何公司代码、业务名称、地址或凭据。

## 五天路线

- Day 01：工程基础、Diff 解析、本地规则、Web 工作台。
- Day 02：Mock / OpenAI-compatible / Ollama Provider 与结构化 AI 审查（已完成）。
- Day 03：SSE、取消、超时、SQLite 历史记录和 Markdown 导出。
- Day 04：敏感信息脱敏和可重复评测集。
- Day 05：Docker、CI、完整测试、架构图与演示材料。
