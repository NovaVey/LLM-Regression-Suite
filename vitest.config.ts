import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    // Phase 9: packages/web's tests render React components (jsdom), every
    // other package's tests are pure Node (stats, DB orchestration, CLI) --
    // one override rather than a jsdom environment paid for by 22 files
    // that never touch the DOM.
    environmentMatchGlobs: [['packages/web/**', 'jsdom']],
  },
});
