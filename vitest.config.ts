import { defineConfig } from 'vitest/config';

// Vitest runs only Vitest-authored suites.
// Node's built-in test runner handles tests/*.native.test.mjs and tests/*.test.js.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
