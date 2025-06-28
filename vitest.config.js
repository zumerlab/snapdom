import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      // https://vitest.dev/guide/browser/playwright
      instances: [
        { browser: 'chromium' },
      ],
    },
    coverage: {
      provider: 'v8', // o 'istanbul'
      include: [
        'src/**/*.js',      // Solo archivos JS dentro de src/
      ],
    },
  },
})
