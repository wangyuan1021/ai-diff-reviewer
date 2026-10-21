import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  noExternal: [/.*/],
  banner: {
    js: "import { createRequire as __bundleCreateRequire } from 'node:module'; const require = __bundleCreateRequire(import.meta.url);",
  },
})
