import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    css: true,
    environment: 'node',
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-client-ui-primitives', 'katex'],
      },
    },
  },
})
