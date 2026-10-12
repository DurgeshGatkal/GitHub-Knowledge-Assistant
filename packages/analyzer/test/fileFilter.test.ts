/**
 * fileFilter.test.ts
 *
 * Tests for the file filter — we know exactly which files should be kept or
 * skipped, so we verify 100% accuracy on known cases.
 */

import { describe, it, expect } from 'vitest';
import { shouldAnalyzeFile } from '../src/fetcher/fileFilter.js';

describe('shouldAnalyzeFile', () => {
  // ── Files that SHOULD be kept ──────────────────────────────────────────────
  it('keeps .ts files', () => {
    expect(shouldAnalyzeFile('src/utils/price.ts', 1000)).toBe(true);
  });

  it('keeps .tsx files', () => {
    expect(shouldAnalyzeFile('src/components/Button.tsx', 1000)).toBe(true);
  });

  it('keeps .js files', () => {
    expect(shouldAnalyzeFile('lib/helpers.js', 1000)).toBe(true);
  });

  it('keeps .jsx files', () => {
    expect(shouldAnalyzeFile('src/App.jsx', 500)).toBe(true);
  });

  it('keeps .mjs files', () => {
    expect(shouldAnalyzeFile('src/loader.mjs', 200)).toBe(true);
  });

  it('keeps .cjs files', () => {
    expect(shouldAnalyzeFile('src/config.cjs', 200)).toBe(true);
  });

  // ── Files that SHOULD be skipped ──────────────────────────────────────────
  it('skips files inside node_modules', () => {
    expect(shouldAnalyzeFile('node_modules/react/index.js', 1000)).toBe(false);
  });

  it('skips files inside dist/', () => {
    expect(shouldAnalyzeFile('dist/bundle.js', 1000)).toBe(false);
  });

  it('skips files inside build/', () => {
    expect(shouldAnalyzeFile('build/output.js', 1000)).toBe(false);
  });

  it('skips minified .js files', () => {
    expect(shouldAnalyzeFile('public/vendor.min.js', 1000)).toBe(false);
  });

  it('skips TypeScript declaration files (.d.ts)', () => {
    expect(shouldAnalyzeFile('src/types.d.ts', 500)).toBe(false);
  });

  it('skips source map files', () => {
    expect(shouldAnalyzeFile('src/index.js.map', 1000)).toBe(false);
  });

  it('skips package-lock.json', () => {
    expect(shouldAnalyzeFile('package-lock.json', 50000)).toBe(false);
  });

  it('skips yarn.lock', () => {
    expect(shouldAnalyzeFile('yarn.lock', 80000)).toBe(false);
  });

  it('skips files that exceed the size limit', () => {
    const overLimit = 2 * 1024 * 1024 + 1; // 2MB + 1 byte
    expect(shouldAnalyzeFile('src/huge.ts', overLimit)).toBe(false);
  });

  it('skips files with no extension', () => {
    expect(shouldAnalyzeFile('Makefile', 500)).toBe(false);
  });

  it('skips .json files', () => {
    expect(shouldAnalyzeFile('src/data.json', 500)).toBe(false);
  });

  it('skips nested node_modules path', () => {
    expect(shouldAnalyzeFile('packages/core/node_modules/lodash/index.js', 1000)).toBe(false);
  });
});
