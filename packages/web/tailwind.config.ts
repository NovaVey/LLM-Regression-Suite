import type { Config } from 'tailwindcss';

// Palette and type direction per .claude/commands/build-llm-regression-suite.md §8 —
// "lab notebook, not dashboard." report-designer owns how these get used (Phase 7/9);
// this file just wires the tokens the spec already fixed so nobody re-picks colors later.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAFAF8',
        ink: '#16181D',
        rule: '#DCDDD8',
        alert: '#A23B2C',
        settled: '#2C5F4F',
        muted: '#7A7E85',
      },
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
