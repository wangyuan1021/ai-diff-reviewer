import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: ['@ai-diff-reviewer/diff-engine', '@ai-diff-reviewer/shared'],
})
