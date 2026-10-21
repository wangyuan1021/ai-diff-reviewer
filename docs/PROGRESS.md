# AI Diff Reviewer 开发交接记录

本文档用于跨对话、跨开发日继续项目。开始新一轮开发前，请先阅读本文档和根目录 `README.md`，再检查当前 Git 状态与测试结果。

## 项目概况

- 项目名称：AI Diff Reviewer
- 项目路径：仓库根目录
- GitHub 仓库：以当前项目的 `origin` remote 为准
- 当前分支：`main`
- 当前阶段：Day 05 已完成
- 最近完成阶段：Day 05 容器化、CI、完整验证与演示材料
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
9. 外部 Provider 只接收脱敏分块和匿名文件 ID；真实文件路径在本地映射和校验。
10. 评测集只使用完全虚构的最小 Diff，清单与生成报告一并版本化。

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

## Day 03 完成内容

### 异步任务与 SSE

- 新增异步任务状态模型，覆盖排队、运行、完成、失败、取消和超时。
- 新增 `POST /api/review-tasks`、任务快照、SSE 进度和取消接口。
- 进度覆盖 Diff 解析、本地规则、AI Provider、历史保存和完成阶段。
- 客户端取消信号贯穿至 OpenAI-compatible 与 Ollama 的 HTTP 请求。
- `REVIEW_TASK_TIMEOUT_MS` 控制端到端任务超时，和单次 Provider 超时相互独立。
- 终态任务默认保留 15 分钟后从内存清理，避免长期持有实时审查结果。
- 保留 Day 02 同步 API，Web 工作台默认改用异步任务接口。

### SQLite 隐私历史

- 使用 Node.js 22 内置 SQLite，默认数据库为仓库根目录 `data/reviews.db`。
- 仅保存 Diff SHA-256、统计、风险数量、Provider/模型、耗时和结构化结果。
- 写库前移除所有文件 hunk，并对结构化文本中出现的原始变更行做脱敏。
- 数据库及伴随文件已通过 `.gitignore` 排除，不会提交到 GitHub。
- 新增历史列表和详情接口，支持分页读取。

### Markdown 导出与页面

- 新增历史 Markdown 下载接口，报告包含摘要、风险、文件统计、测试建议和发布检查。
- Markdown 不包含原始 Diff 或 hunk 内容。
- 页面展示实时进度条、任务 ID 和取消操作。
- 页面增加历史列表、详情回看和 Markdown 导出入口。

## Day 03 验收结果

- [x] Mock、本地规则及外部 Provider 均可通过异步任务执行。
- [x] SSE 推送任务进度和最终结果，客户端可主动取消。
- [x] 全流程超时会终止 Provider 请求并形成明确任务状态。
- [x] SQLite 不保存原始 Diff 或 hunk，隐私边界有自动化测试。
- [x] 历史列表、详情和 Markdown 导出接口已实现。
- [x] Day 02 同步接口保持兼容。

## Day 03 验证证据

- TypeScript：4 个 workspace 包通过。
- 新增历史隐私、Markdown、任务完成、取消和全流程超时测试。
- Vitest/Supertest：8 个测试文件、32 项测试全部通过，包含 SSE 端到端覆盖。
- ESLint、4 个 workspace 包 TypeScript 检查、服务端与 Web 生产构建全部通过。
- 浏览器实测：Mock 审查展示 2 个文件、7 项风险、2/2 分块覆盖；历史自动刷新，详情中代码证据已脱敏，控制台无 error 或 warning。

## Day 04 完成内容

### 敏感信息检测与 Prompt 脱敏

- 新增统一敏感信息扫描器，覆盖凭据、Bearer/GitHub/Slack/JWT 类令牌、私钥、带账号密码连接串、邮箱和私网 IP。
- 本地规则复用扫描器，硬编码秘密不会在风险证据中回显；邮箱和私网 IP 形成独立的敏感信息风险。
- AI 分块在 Provider 调用前以类型占位符替换敏感值，并把真实路径稳定映射为 `FILE_001` 一类匿名 ID。
- 模型风险通过匿名 ID 和有效新文件行号校验后，才在本地恢复为真实路径。
- AI 元数据记录脱敏数量、敏感类型和路径匿名化状态，页面显示 Prompt 隐私摘要。
- 脱敏覆盖 Diff 行及 hunk 标题，并保留原始行号；私钥多行内容整体替换。

### 可重复评测

- 新增 `evaluation/cases/` 下 16 个完全虚构的独立 Diff 样本，包含干净负例、单项风险、组合风险和源码带测试的负例。
- `evaluation/manifest.json` 声明每个样本的预期规则集合与敏感类型。
- `pnpm eval` 确定性执行本地规则和脱敏评测，失败时返回非零退出码。
- 评测生成 `docs/EVALUATION.md` 和 `docs/evaluation-results.json`，不调用外部模型。

## Day 04 验收结果

- [x] AI Provider 请求中不包含测试里的原始敏感值或真实文件路径。
- [x] 本地规则识别硬编码秘密、邮箱和私网 IP，证据不泄露原值。
- [x] 16 个评测样本全部通过，26/26 预期规则命中，7/7 敏感类型命中，无意外规则命中。
- [x] 单元测试覆盖常见敏感格式、多行私钥、hunk 标题、行号保持和 Provider 消息边界。
- [x] 页面公开展示 Prompt 路径匿名化与脱敏数量。

## Day 04 验证证据

- `pnpm eval`：16/16 样本通过，规则召回 100.0%，敏感类型召回 100.0%。
- `pnpm check`：ESLint 零错误，4 个 workspace 类型检查通过，9 个测试文件、38 项测试全部通过，Server/Web 生产构建成功。
- 详细结果见 [`docs/EVALUATION.md`](EVALUATION.md)。

## Day 05 完成内容

### Docker 与部署

- 新增多阶段 `Dockerfile`，Builder 统一构建 Server/Web，生产 Server 镜像只携带独立 bundle。
- 新增 `compose.yaml`，Web 通过 Nginx 同源代理 `/api`，API 只在 Compose 网络内暴露。
- Server 与 Web 均配置健康检查；Web 等待 API 健康后启动。
- SQLite 使用 `review-data` 命名卷持久化，容器默认继续使用 Mock Provider。
- Nginx 禁用 API 响应缓冲以支持 SSE，并增加基础响应安全头。

### CI 与完整验证

- 新增 GitHub Actions：Node 22 + pnpm 11 执行 `pnpm check` 和 `pnpm eval`。
- CI 验证生成的评测报告没有漂移，并用 Buildx 分别构建 Server/Web 镜像目标。
- `pnpm check` 新增生产 bundle HTTP 冒烟测试，覆盖健康检查、Mock 异步任务、历史隐私和 Markdown 导出。
- 将 Server 打包为独立运行 bundle，并修复 `node:sqlite` 与 CommonJS 依赖在 ESM bundle 中的运行兼容问题。

### 架构与演示材料

- `docs/ARCHITECTURE.md` 提供系统结构图、审查时序图、代码边界和部署结构。
- `docs/DEMO.md` 提供本地/Docker 启动方法、3 分钟演示脚本和演示边界。
- `docs/PORTFOLIO.md` 总结问题背景、工程亮点、质量证据、技术取舍和后续演进。
- 新增真实 Mock 审查结果截图 `docs/assets/demo-result.png`，并在 README 和演示文档中展示。

## Day 05 验收结果

- [x] 多阶段 Dockerfile 与 Compose 覆盖 Web、API、健康检查、同源代理和 SQLite 数据卷。
- [x] GitHub Actions 覆盖代码检查、确定性评测、报告漂移和两个镜像目标构建。
- [x] 生产 Server bundle 可在无项目 `node_modules` 的运行方式下启动并完成 HTTP 冒烟测试。
- [x] 架构图、演示脚本、真实页面截图和作品说明齐全。
- [x] 页面实测 Mock 审查、SSE 完成、历史刷新与结果展示，浏览器控制台无 error 或 warning。

## Day 05 验证证据

- `pnpm check`：ESLint 零错误，4 个 workspace 类型检查通过，9 个测试文件、38 项测试通过，Server/Web 生产构建成功，HTTP 冒烟测试通过。
- `pnpm eval`：16/16 样本通过，26/26 预期规则命中，7/7 敏感类型命中。
- 浏览器实测：默认样例识别 2 个文件、7 项风险、Mock AI 2/2 分块覆盖，历史自动刷新。
- 当前开发机没有 Docker CLI，未在本地执行镜像构建；`.github/workflows/ci.yml` 已配置 Buildx 构建两个目标，需由 GitHub Actions 或安装 Docker 的环境最终运行验证。

## 后续范围

- MVP 五天路线已完成。后续可增加真实项目盲测、团队规则配置、PR 集成、鉴权与多实例任务队列。

## 新对话开场语

```text
继续开发当前 AI Diff Reviewer 仓库。
请先阅读 README.md 和 docs/PROGRESS.md，检查 Git 状态并运行现有测试。五天 MVP 已完成，请从“后续范围”选择下一阶段，继续遵守隐私边界，不要使用或引入任何公司代码和敏感信息。
```

## Git 注意事项

- 提交前确认 `git status`，不得提交 `.env`、API Key、原始公司 Diff、内部地址、`node_modules`、`.pnpm-store` 或构建产物。
- 使用仓库级 Git 身份配置，避免修改或依赖全局 Git 配置。
