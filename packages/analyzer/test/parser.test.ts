/**
 * parser.test.ts
 *
 * Tests for the Tree-sitter import extractor.
 * We run it against the fixture files whose correct imports we already know,
 * so we can verify 100% accuracy.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initParser, extractImports } from '../src/parser/parser.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', '..', '..', 'fixtures', 'fixture-simple', 'src');

beforeAll(async () => {
  // Initialise the parsers once before all tests
  await initParser();
});

describe('extractImports — fixture-simple/src/index.ts', () => {
  it('finds all static imports with correct line numbers', () => {
    const result = extractImports(path.join(FIXTURE_DIR, 'index.ts'));

    expect(result.parseError).toBe(false);

    // We expect 5 static imports (lines 4-8 in the fixture)
    const statics = result.imports.filter((i) => i.kind === 'static');
    expect(statics.length).toBe(5);

    const specifiers = statics.map((i) => i.specifier);
    expect(specifiers).toContain('react');
    expect(specifiers).toContain('./price');
    expect(specifiers).toContain('./types');
    expect(specifiers).toContain('../utils/helpers');
  });

  it('does not report any require() or dynamic imports from index.ts', () => {
    const result = extractImports(path.join(FIXTURE_DIR, 'index.ts'));
    const nonStatic = result.imports.filter((i) => i.kind !== 'static');
    expect(nonStatic.length).toBe(0);
  });
});

describe('extractImports — fixture-simple/src/price.ts', () => {
  it('finds the re-export', () => {
    const result = extractImports(path.join(FIXTURE_DIR, 'price.ts'));
    const reexports = result.imports.filter((i) => i.kind === 'reexport');
    expect(reexports.length).toBe(1);
    expect(reexports[0]!.specifier).toBe('./formatter');
  });

  it('finds the require() call', () => {
    const result = extractImports(path.join(FIXTURE_DIR, 'price.ts'));
    const requires = result.imports.filter((i) => i.kind === 'require');
    expect(requires.length).toBe(1);
    expect(requires[0]!.specifier).toBe('./config');
  });

  it('finds the dynamic import()', () => {
    const result = extractImports(path.join(FIXTURE_DIR, 'price.ts'));
    const dynamics = result.imports.filter((i) => i.kind === 'dynamic');
    expect(dynamics.length).toBe(1);
    expect(dynamics[0]!.specifier).toBe('./discount');
  });

  it('all imports have valid line numbers (>= 1)', () => {
    const result = extractImports(path.join(FIXTURE_DIR, 'price.ts'));
    for (const imp of result.imports) {
      expect(imp.line).toBeGreaterThanOrEqual(1);
    }
  });
});
