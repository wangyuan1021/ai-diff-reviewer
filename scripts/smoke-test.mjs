import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const configuredBaseUrl = process.env.SMOKE_BASE_URL
const port = process.env.SMOKE_PORT ?? '43117'
const baseUrl = configuredBaseUrl ?? `http://127.0.0.1:${port}`
const rawCodeMarker = 'SMOKE_RAW_CODE_MUST_NOT_PERSIST'
const diff = `diff --git a/src/demo.ts b/src/demo.ts
--- a/src/demo.ts
+++ b/src/demo.ts
@@ -1 +1,2 @@
 export const enabled = true
+console.log('${rawCodeMarker}')
`

let server
let serverOutput = ''
let isolatedDirectory

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} returned ${response.status}: ${text}`)
  }
  return { response, body, text }
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (server?.exitCode !== null) {
      throw new Error(`server exited before becoming healthy\n${serverOutput}`)
    }
    try {
      const { body } = await request('/api/health')
      if (body.status === 'ok') return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`server did not become healthy at ${baseUrl}`)
}

async function waitForTask(id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { body } = await request(`/api/review-tasks/${id}`)
    if (['completed', 'failed', 'cancelled', 'timed-out'].includes(body.task.status)) {
      return body.task
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('review task did not reach a terminal state')
}

try {
  if (!configuredBaseUrl) {
    isolatedDirectory = await mkdtemp(join(tmpdir(), 'ai-diff-reviewer-smoke-'))
    await mkdir(join(isolatedDirectory, 'server'))
    await copyFile('apps/server/dist/index.js', join(isolatedDirectory, 'server/index.js'))
    await writeFile(join(isolatedDirectory, 'package.json'), '{"type":"module"}\n')
    server = spawn(process.execPath, ['server/index.js'], {
      cwd: isolatedDirectory,
      env: {
        ...process.env,
        AI_PROVIDER: 'mock',
        DATABASE_PATH: ':memory:',
        NODE_ENV: 'production',
        PORT: port,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout.on('data', (chunk) => {
      serverOutput += chunk.toString()
    })
    server.stderr.on('data', (chunk) => {
      serverOutput += chunk.toString()
    })
  }

  await waitForHealth()
  const created = await request('/api/review-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diff, mode: 'mock' }),
  })
  assert(created.response.status === 202, 'task creation did not return 202')
  const task = await waitForTask(created.body.task.id)
  assert(task.status === 'completed', `task finished as ${task.status}`)
  assert(task.result?.ai?.provider === 'mock', 'mock provider metadata is missing')

  const history = await request('/api/history?limit=1')
  assert(history.body.items[0]?.id === task.id, 'completed task is missing from history')
  const detail = await request(`/api/history/${task.id}`)
  assert(detail.body.result.changedFiles[0]?.hunks.length === 0, 'history contains hunk data')
  assert(!detail.text.includes(rawCodeMarker), 'history contains a raw changed line')

  const markdown = await request(`/api/history/${task.id}/markdown`)
  assert(
    markdown.response.headers.get('content-type')?.includes('text/markdown'),
    'bad report type',
  )
  assert(!markdown.text.includes(rawCodeMarker), 'Markdown report contains a raw changed line')
  console.info(`Smoke test passed against ${baseUrl}`)
} finally {
  if (server?.exitCode === null && !server.killed) {
    server.kill('SIGTERM')
    await new Promise((resolve) => server.once('exit', resolve))
  }
  if (isolatedDirectory) await rm(isolatedDirectory, { recursive: true, force: true })
}
