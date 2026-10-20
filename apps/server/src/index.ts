import 'dotenv/config'
import { createApp } from './app'
import { config } from './config'

const app = createApp()

app.on('error', (error) => {
  console.error('[server:error]', error instanceof Error ? error.message : 'Unknown error')
})

app.listen(config.port, () => {
  console.info(`AI Diff Reviewer API running at http://localhost:${config.port}`)
})
