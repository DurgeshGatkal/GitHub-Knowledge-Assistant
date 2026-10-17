import { defineConfig } from 'vitest/config';

/**
 * Root vitest configuration.
 *
 * WHY this file exists:
 *   The real test suites live in packages/<name>/test/. Without a root config,
 *   vitest's default include pattern matches every test-named file in the repo,
 *   including the fixture repositories under fixtures/. Those fixture files are
 *   named like test files on purpose — they exercise the analyzer's
 *   test-matching rules (import-based and name-proximity) — but they are not
 *   test suites themselves.
 *
 *   Scoping the include keeps `npx vitest run` and `npm test` green from the
 *   repository root.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
  },
});
