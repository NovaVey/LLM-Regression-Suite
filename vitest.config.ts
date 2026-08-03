import { defineConfig } from 'vitest/config';

// Phase 9: packages/web's tests render React components (jsdom), every
// other package's tests are pure Node (stats, DB orchestration, CLI) -- two
// projects rather than a jsdom environment paid for by 22 files that never
// touch the DOM. An earlier version of this file used `environmentMatchGlobs`
// to do this with a single `test` block; that option does not exist in
// Vitest 4 (removed along with the old `vitest.workspace.ts` mechanism it
// belonged to) and was being silently ignored -- every packages/web test was
// actually running under the default 'node' environment and would have
// failed with "document is not defined" if not for a per-file
// `// @vitest-environment jsdom` pragma each test file also carries as a
// belt-and-suspenders backstop. `test.projects` is the real Vitest 4
// mechanism for this. See docs/DECISIONS.md.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
          exclude: ['packages/web/**'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          include: ['packages/web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
