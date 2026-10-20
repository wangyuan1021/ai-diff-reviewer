# AI Diff Reviewer

一个可解释、可评测、隐私优先的 Git Diff 风险分析工具。当前 Day 01 版本只运行本地静态规则，不调用外部 AI，也不保存原始 Diff。

当前开发状态、验证证据、技术决策和下一步计划见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

## 当前能力

- 粘贴 Unified Diff，或上传 `.diff`、`.patch`、`.txt` 文件。
- 解析新增、修改、删除、重命名文件及其代码块和行号。
- 统计文件数、新增行、删除行和总变更行数。
- 识别依赖、配置、数据库迁移、认证权限、公共 API 等高影响变更。
- 检查动态代码执行、疑似硬编码密钥、调试输出、未完成标记和异常处理删除。
- 在业务代码变更但没有测试变更时给出提示。
- 返回结构化风险证据、影响、修复建议、测试建议与发布检查表。

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

页面默认带有一份虚构风险样例，也可以使用 `samples/day-01-risky.diff`。

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

默认限制为 512 KiB，可通过 `MAX_DIFF_BYTES` 调整。环境变量示例见 `.env.example`。

## 隐私边界

- 当前版本不会把 Diff 发送给任何模型或第三方服务。
- 当前版本没有数据库，不会持久化原始 Diff 或审查结果。
- 风险规则不能替代人工代码审查、安全审计和完整测试。
- 示例均为虚构代码，不包含任何公司代码、业务名称、地址或凭据。

## 五天路线

- Day 01：工程基础、Diff 解析、本地规则、Web 工作台。
- Day 02：Mock / OpenAI-compatible / Ollama Provider 与结构化 AI 审查。
- Day 03：SSE、取消、超时、SQLite 历史记录和 Markdown 导出。
- Day 04：敏感信息脱敏和可重复评测集。
- Day 05：Docker、CI、完整测试、架构图与演示材料。
