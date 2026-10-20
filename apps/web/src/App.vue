<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApiError, LocalReviewResult, RiskSeverity } from '@ai-diff-reviewer/shared'
import { sampleDiff } from './sample'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const diff = ref(sampleDiff)
const result = ref<LocalReviewResult | null>(null)
const errorMessage = ref('')
const isLoading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const lineCount = computed(() => (diff.value ? diff.value.split('\n').length : 0))
const byteCount = computed(() => new Blob([diff.value]).size)

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

  try {
    const response = await fetch(`${apiBaseUrl}/api/reviews/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diff: diff.value }),
    })
    const body = (await response.json()) as LocalReviewResult | ApiError
    if (!response.ok) {
      throw new Error('error' in body ? body.error.message : '分析失败，请稍后重试。')
    }
    result.value = body as LocalReviewResult
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '分析失败，请稍后重试。'
  } finally {
    isLoading.value = false
  }
}

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
      <div class="privacy-badge"><span></span> 本地规则模式 · 原始 Diff 不落库</div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="eyebrow">EXPLAINABLE CODE REVIEW</div>
        <h1>让每一次代码变更<br /><em>都有证据可循</em></h1>
        <p>解析 Git Diff，定位文件与行号，通过本地规则发现安全、兼容性和测试风险。</p>
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

        <div class="analyze-row">
          <p>当前阶段只运行本地静态规则，不会向外部模型发送代码。</p>
          <button
            class="button button-primary"
            type="button"
            :disabled="isLoading"
            @click="analyze"
          >
            <span v-if="isLoading" class="spinner"></span>
            {{ isLoading ? '正在分析' : '开始风险分析' }}
          </button>
        </div>
      </section>

      <section v-if="result" class="results" aria-live="polite">
        <div class="section-heading result-title">
          <div>
            <span class="step">02</span>
            <h2>分析结果</h2>
          </div>
          <span class="result-time">{{ new Date(result.analyzedAt).toLocaleString('zh-CN') }}</span>
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
                <code>{{ risk.ruleId }}</code>
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

    <footer>DAY 01 · LOCAL RULE ENGINE · NO AI REQUIRED</footer>
  </div>
</template>
