import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // Load .env.local so VITE_ vars are available in tests
    env: await (async () => {
      const { loadEnv } = await import('vite')
      return loadEnv('test', process.cwd(), '')
    })(),
    // Give real API calls room to breathe
    testTimeout: 15_000,
  },
})
