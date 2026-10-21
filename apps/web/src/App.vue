<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  AIProviderName,
  AIReviewResult,
  ApiError,
  LocalReviewResult,
  RiskSeverity,
  ReviewHistoryDetail,
  ReviewHistoryList,
  ReviewHistorySummary,
  ReviewTaskSnapshot,
} from '@ai-diff-reviewer/shared'
import { sampleDiff } from './sample'

type ReviewMode = 'local' | AIProviderName

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const diff = ref(sampleDiff)
const result = ref<LocalReviewResult | AIReviewResult | null>(null)
const errorMessage = ref('')
const isLoading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const reviewMode = ref<ReviewMode>('mock')
const task = ref<ReviewTaskSnapshot | null>(null)
const history = ref<ReviewHistoryList>({ items: [], total: 0 })
const selectedHistory = ref<ReviewHistoryDetail | null>(null)
let eventSource: EventSource | null = null

const lineCount = computed(() => (diff.value ? diff.value.split('\n').length : 0))
const byteCount = computed(() => new Blob([diff.value]).size)
const isAIResult = computed((): boolean => Boolean(result.value && 'ai' in result.value))
const reportDownloadUrl = computed(() => {
  const historyId =
    selectedHistory.value?.id ?? (task.value?.status === 'completed' ? task.value.id : '')
  return historyId ? `${apiBaseUrl}/api/history/${historyId}/markdown` : ''
})

const modeText: Record<ReviewMode, string> = {
  local: '本地规则',
  mock: 'Mock AI',
  'openai-compatible': 'OpenAI-compatible',
  ollama: 'Ollama',
}

const severityText: Record<RiskSeverity, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '严重',
}

async function analyze() {
  if (!diff.value.trim()) {
    errorMessage.value = '请先粘贴或上传 Git Diff。'
    return
  }

  isLoading.value = true
  errorMessage.value = ''
  result.value = null
  task.value = null
  selectedHistory.value = null
  eventSource?.close()

  try {
    const useAI = reviewMode.value !== 'local'
    const response = await fetch(`${apiBaseUrl}/api/review-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        diff: diff.value,
        mode: useAI ? reviewMode.value : 'local',
      }),
    })
    const body = (await response.json()) as { task: ReviewTaskSnapshot } | ApiError
    if (!response.ok) {
      throw new Error('error' in body ? body.error.message : '分析失败，请稍后重试。')
    }
    if (!('task' in body)) throw new Error('服务返回了无法识别的任务数据。')
    task.value = body.task
    connectToTask(body.task.id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '分析失败，请稍后重试。'
    isLoading.value = false
  }
}

function connectToTask(taskId: string) {
  eventSource?.close()
  eventSource = new EventSource(`${apiBaseUrl}/api/review-tasks/${taskId}/events`)
  eventSource.addEventListener('task', (event) => {
    const next = JSON.parse((event as MessageEvent).data) as ReviewTaskSnapshot
    errorMessage.value = ''
    task.value = next
    if (next.status === 'completed' && next.result) {
      result.value = next.result
      isLoading.value = false
      eventSource?.close()
      void loadHistory()
    } else if (['failed', 'cancelled', 'timed-out'].includes(next.status)) {
      errorMessage.value = next.error?.message ?? '分析未完成。'
      isLoading.value = false
      eventSource?.close()
    }
  })
  eventSource.onerror = () => {
    if (
      task.value &&
      !['completed', 'failed', 'cancelled', 'timed-out'].includes(task.value.status)
    ) {
      errorMessage.value = '进度连接中断，请稍后查看任务状态。'
    }
  }
}

async function cancelTask() {
  if (!task.value || !isLoading.value) return
  try {
    const response = await fetch(`${apiBaseUrl}/api/review-tasks/${task.value.id}`, {
      method: 'DELETE',
    })
    const body = (await response.json()) as { task: ReviewTaskSnapshot } | ApiError
    if (!response.ok) throw new Error('error' in body ? body.error.message : '取消失败。')
    if (!('task' in body)) throw new Error('服务返回了无法识别的任务数据。')
    task.value = body.task
    errorMessage.value = body.task.error?.message ?? '审查任务已取消。'
    isLoading.value = false
    eventSource?.close()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '取消失败。'
  }
}

async function loadHistory() {
  try {
    const response = await fetch(`${apiBaseUrl}/api/history?limit=8`)
    if (!response.ok) return
    history.value = (await response.json()) as ReviewHistoryList
  } catch {
    return
  }
}

async function openHistory(item: ReviewHistorySummary) {
  try {
    const response = await fetch(`${apiBaseUrl}/api/history/${item.id}`)
    if (!response.ok) throw new Error('历史记录加载失败。')
    const detail = (await response.json()) as ReviewHistoryDetail
    selectedHistory.value = detail
    result.value = detail.result
    errorMessage.value = ''
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '历史记录加载失败。'
  }
}

onMounted(() => {
  void loadHistory()
})

onBeforeUnmount(() => {
  eventSource?.close()
})

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (!/\.(diff|patch|txt)$/i.test(file.name)) {
    errorMessage.value = '请选择 .diff、.patch 或 .txt 文件。'
    target.value = ''
    return
  }

  diff.value = await file.text()
  result.value = null
  errorMessage.value = ''
  target.value = ''
}

function resetSample() {
  diff.value = sampleDiff
  result.value = null
  errorMessage.value = ''
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#top" aria-label="AI Diff Reviewer 首页">
        <span class="brand-mark">DR</span>
        <span>AI Diff Reviewer</span>
      </a>
      <div class="privacy-badge"><span></span> 隐私优先 · 原始 Diff 不落库</div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="eyebrow">EXPLAINABLE CODE REVIEW</div>
        <h1>让每一次代码变更<br /><em>都有证据可循</em></h1>
        <p>解析 Git Diff，结合本地规则与可替换 AI Provider，给出可验证的风险证据。</p>
      </section>

      <section class="workspace" aria-labelledby="workspace-title">
        <div class="section-heading">
          <div>
            <span class="step">01</span>
            <h2 id="workspace-title">输入变更内容</h2>
          </div>
          <div class="input-actions">
            <button class="button button-ghost" type="button" @click="resetSample">载入示例</button>
            <button class="button button-ghost" type="button" @click="openFilePicker">
              上传文件
            </button>
            <input
              ref="fileInput"
              class="sr-only"
              type="file"
              accept=".diff,.patch,.txt,text/plain"
              @change="handleFile"
            />
          </div>
        </div>

        <div class="editor-wrap">
          <div class="editor-bar">
            <span><i></i><i></i><i></i></span>
            <span>change.diff</span>
            <span>{{ lineCount }} 行 · {{ (byteCount / 1024).toFixed(1) }} KB</span>
          </div>
          <textarea
            v-model="diff"
            spellcheck="false"
            aria-label="Git Diff 内容"
            placeholder="在这里粘贴 git diff 输出……"
          ></textarea>
        </div>

        <div v-if="errorMessage" class="alert" role="alert">{{ errorMessage }}</div>

        <div v-if="isLoading && task" class="progress-card" role="status" aria-live="polite">
          <div class="progress-copy">
            <strong>{{ task.progress.message }}</strong>
            <span>{{ task.progress.percent }}%</span>
          </div>
          <div class="progress-track">
            <span :style="{ width: `${task.progress.percent}%` }"></span>
          </div>
          <code>{{ task.id }}</code>
        </div>

        <div class="analyze-row">
          <div class="mode-control">
            <label for="review-mode">审查模式</label>
            <select id="review-mode" v-model="reviewMode" :disabled="isLoading">
              <option value="local">本地规则（不调用模型）</option>
              <option value="mock">Mock AI（无需 API Key）</option>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="ollama">Ollama（本地服务）</option>
            </select>
            <p v-if="reviewMode === 'local'">Diff 仅在本机 API 中执行静态规则。</p>
            <p v-else-if="reviewMode === 'mock'">确定性演示响应，不会发送到外部服务。</p>
            <p v-else>匿名路径与脱敏后的 Diff 分块将发送至服务端配置的 Provider。</p>
          </div>
          <div class="review-actions">
            <button v-if="isLoading" class="button button-danger" type="button" @click="cancelTask">
              取消任务
            </button>
            <button
              class="button button-primary"
              type="button"
              :disabled="isLoading"
              @click="analyze"
            >
              <span v-if="isLoading" class="spinner"></span>
              {{ isLoading ? '正在分析' : `使用${modeText[reviewMode]}分析` }}
            </button>
          </div>
        </div>
      </section>

      <section class="history-panel" aria-labelledby="history-title">
        <div class="section-heading">
          <div>
            <span class="step">02</span>
            <h2 id="history-title">审查历史</h2>
          </div>
          <span class="history-count">{{ history.total }} RECORDS · 不保存原始 Diff</span>
        </div>
        <div v-if="history.items.length" class="history-list">
          <article v-for="item in history.items" :key="item.id" class="history-item">
            <button type="button" class="history-open" @click="openHistory(item)">
              <span :class="['severity-dot', `dot-${item.overallRisk}`]"></span>
              <span>
                <strong>{{ modeText[item.mode] }} · {{ item.riskCount }} 项风险</strong>
                <small>
                  {{ new Date(item.completedAt).toLocaleString('zh-CN') }} ·
                  {{ item.statistics.filesChanged }} 文件 · {{ item.durationMs }}ms
                </small>
              </span>
            </button>
            <a
              class="history-export"
              :href="`${apiBaseUrl}/api/history/${item.id}/markdown`"
              target="_blank"
              rel="noopener"
              >导出 MD</a
            >
          </article>
        </div>
        <div v-else class="history-empty">
          完成一次异步审查后，隐私安全的结构化结果会显示在这里。
        </div>
      </section>

      <section v-if="result" class="results" aria-live="polite">
        <div class="section-heading result-title">
          <div>
            <span class="step">03</span>
            <h2>分析结果</h2>
          </div>
          <div class="result-heading-actions">
            <a
              v-if="reportDownloadUrl"
              class="button button-ghost export-button"
              :href="reportDownloadUrl"
              target="_blank"
              rel="noopener"
              >导出 Markdown</a
            >
            <span class="result-time">{{
              new Date(result.analyzedAt).toLocaleString('zh-CN')
            }}</span>
          </div>
        </div>

        <div class="metrics">
          <article>
            <span>变更文件</span>
            <strong>{{ result.statistics.filesChanged }}</strong>
          </article>
          <article>
            <span>新增 / 删除</span>
            <strong class="changes"
              >+{{ result.statistics.additions }} / -{{ result.statistics.deletions }}</strong
            >
          </article>
          <article>
            <span>发现风险</span>
            <strong>{{ result.risks.length }}</strong>
          </article>
          <article>
            <span>总体等级</span>
            <strong :class="['severity-text', `severity-${result.overallRisk}`]">
              {{ severityText[result.overallRisk] }}
            </strong>
          </article>
        </div>

        <div v-if="isAIResult && result && 'ai' in result" class="ai-metadata">
          <div>
            <span>Provider</span>
            <strong>{{ result.ai.provider }}</strong>
          </div>
          <div>
            <span>模型</span>
            <strong>{{ result.ai.model }}</strong>
          </div>
          <div>
            <span>耗时 / 置信度</span>
            <strong
              >{{ result.ai.durationMs }}ms · {{ Math.round(result.ai.confidence * 100) }}%</strong
            >
          </div>
          <div>
            <span>AI 覆盖</span>
            <strong>
              {{ result.ai.coverage.reviewedChunks }}/{{ result.ai.coverage.totalChunks }} 分块
              <em v-if="result.ai.coverage.truncated">有截断</em>
            </strong>
          </div>
          <div>
            <span>Prompt 隐私</span>
            <strong v-if="result.ai.redaction">
              路径已匿名化 · {{ result.ai.redaction.findings }} 处脱敏
            </strong>
            <strong v-else>历史记录无脱敏元数据</strong>
          </div>
        </div>

        <div v-if="result.warnings.length" class="warning-list" role="status">
          <p v-for="warning in result.warnings" :key="warning">{{ warning }}</p>
        </div>

        <div class="result-grid">
          <div class="risk-list">
            <div class="block-title">
              <h3>风险证据</h3>
              <span>{{ result.risks.length }} ITEMS</span>
            </div>
            <article v-for="risk in result.risks" :key="risk.id" class="risk-card">
              <div class="risk-card-top">
                <span :class="['severity-pill', `pill-${risk.severity}`]">
                  {{ severityText[risk.severity] }}风险
                </span>
                <div class="risk-origin">
                  <span>{{
                    risk.source === 'combined' ? '本地 + AI' : risk.source === 'ai' ? 'AI' : '本地'
                  }}</span>
                  <code>{{ risk.ruleId }}</code>
                </div>
              </div>
              <h4>{{ risk.title }}</h4>
              <div class="location">
                {{ risk.file }}<template v-if="risk.line">:{{ risk.line }}</template>
              </div>
              <dl>
                <div>
                  <dt>证据</dt>
                  <dd>{{ risk.evidence }}</dd>
                </div>
                <div>
                  <dt>影响</dt>
                  <dd>{{ risk.impact }}</dd>
                </div>
                <div>
                  <dt>建议</dt>
                  <dd>{{ risk.suggestion }}</dd>
                </div>
              </dl>
            </article>
            <div v-if="result.risks.length === 0" class="empty-state">
              当前规则未发现明显风险，但仍建议进行人工审查与测试。
            </div>
          </div>

          <aside>
            <div class="side-card">
              <div class="block-title"><h3>变更文件</h3></div>
              <ul class="file-list">
                <li v-for="file in result.changedFiles" :key="`${file.oldPath}-${file.newPath}`">
                  <span>{{ file.path }}</span>
                  <code>+{{ file.additions }} -{{ file.deletions }}</code>
                </li>
              </ul>
            </div>
            <div class="side-card">
              <div class="block-title"><h3>测试建议</h3></div>
              <ul class="check-list">
                <li v-for="item in result.testSuggestions" :key="item">{{ item }}</li>
              </ul>
            </div>
            <div class="side-card">
              <div class="block-title"><h3>发布检查</h3></div>
              <ul class="check-list">
                <li v-for="item in result.releaseChecklist" :key="item">{{ item }}</li>
              </ul>
            </div>
          </aside>
        </div>
      </section>
    </main>

    <footer>DAY 05 · CONTAINERIZED · CI VERIFIED · DEMO READY</footer>
  </div>
</template>
