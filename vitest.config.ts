import { defineConfig } from 'vitest/config'

// Standalone test config — intentionally does NOT extend vite.config.ts, which
// pulls in the live-feed/summary server middleware (server/*). The engine under
// test (src/lib/*) is pure, dependency-free TypeScript, so a bare node runner is
// both correct and fast.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
