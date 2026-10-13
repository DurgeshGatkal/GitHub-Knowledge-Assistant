/**
 * resolver.test.ts
 *
 * Verifies that resolveFileImports() correctly handles every resolution
 * scenario the plan describes: relative paths, aliases, barrel/index files,
 * .js → .ts mapping, external packages, and unresolvable imports.
 *
 * WHY test with real fixture files?
 *   The TypeScript resolver reads the actual tsconfig.json and the actual file
 *   system. Mocking those would only test the mock, not the resolver behaviour.
 *   Using fixture repos that already exist on disk gives us 100% accuracy
 *   verification (the plan's language: "results match what you check by hand").
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser, extractImports } from '../src/parser/parser.js';
import { loadCompilerOptions, resolveFileImports } from '../src/resolver/resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');

beforeAll(async () => {
  await initParser();
});

// ─────────────────────────────────────────────────────────────────────────────
// fixture-simple: relative path resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveFileImports — fixture-simple relative paths', () => {
  const repoRoot = path.join(FIXTURES, 'fixture-simple');
  const sourceFile = path.join(repoRoot, 'src', 'index.ts');

  it('resolves ./price to src/price.ts', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);

    const resolved = resolveFileImports({
      sourceAbsPath: sourceFile,
      repoRoot,
      imports,
      compilerOptions,
    });

    const priceEdge = resolved.find((r) => r.original.specifier === './price');
    expect(priceEdge).toBeDefined();
    expect(priceEdge!.resolutionMethod).toBe('relative');
    expect(priceEdge!.resolvedRelPath).toBe('src/price.ts');
    expect(priceEdge!.isExternal).toBe(false);
  });

  it('resolves ./types to src/types.ts', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);

    const resolved = resolveFileImports({
      sourceAbsPath: sourceFile,
      repoRoot,
      imports,
      compilerOptions,
    });

    const typesEdge = resolved.find((r) => r.original.specifier === './types');
    expect(typesEdge).toBeDefined();
    expect(typesEdge!.resolvedRelPath).toBe('src/types.ts');
    expect(typesEdge!.isExternal).toBe(false);
  });

  it('marks "react" as an external import (isExternal = true)', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);

    const resolved = resolveFileImports({
      sourceAbsPath: sourceFile,
      repoRoot,
      imports,
      compilerOptions,
    });

    // Both 'react' specifiers (default + named import) should be external
    const reactEdges = resolved.filter((r) => r.original.specifier === 'react');
    expect(reactEdges.length).toBeGreaterThanOrEqual(1);
    for (const edge of reactEdges) {
      expect(edge.isExternal).toBe(true);
      expect(edge.resolvedRelPath).toBeNull();
    }
  });

  it('captures the import line number from the parser', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);

    const resolved = resolveFileImports({
      sourceAbsPath: sourceFile,
      repoRoot,
      imports,
      compilerOptions,
    });

    const priceEdge = resolved.find((r) => r.original.specifier === './price');
    // In fixture-simple/src/index.ts, './price' is on line 6
    expect(priceEdge!.original.line).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fixture-simple: re-export and require resolution (price.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveFileImports — fixture-simple price.ts', () => {
  const repoRoot = path.join(FIXTURES, 'fixture-simple');
  const sourceFile = path.join(repoRoot, 'src', 'price.ts');

  it('resolves ./formatter (re-export)', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);
    const resolved = resolveFileImports({ sourceAbsPath: sourceFile, repoRoot, imports, compilerOptions });

    const edge = resolved.find((r) => r.original.specifier === './formatter');
    expect(edge).toBeDefined();
    expect(edge!.resolvedRelPath).toBe('src/formatter.ts');
    expect(edge!.original.kind).toBe('reexport');
  });

  it('resolves ./config (CommonJS require)', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);
    const resolved = resolveFileImports({ sourceAbsPath: sourceFile, repoRoot, imports, compilerOptions });

    const edge = resolved.find((r) => r.original.specifier === './config');
    expect(edge).toBeDefined();
    expect(edge!.resolvedRelPath).toBe('src/config.ts');
    expect(edge!.original.kind).toBe('require');
  });

  it('resolves ./discount (dynamic import)', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);
    const resolved = resolveFileImports({ sourceAbsPath: sourceFile, repoRoot, imports, compilerOptions });

    const edge = resolved.find((r) => r.original.specifier === './discount');
    expect(edge).toBeDefined();
    expect(edge!.resolvedRelPath).toBe('src/discount.ts');
    expect(edge!.original.kind).toBe('dynamic');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fixture-aliases: alias, barrel, and .js → .ts resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveFileImports — fixture-aliases', () => {
  const repoRoot = path.join(FIXTURES, 'fixture-aliases');
  const sourceFile = path.join(repoRoot, 'src', 'index.ts');

  it('resolves @/utils/helpers via tsconfig path alias', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);
    const resolved = resolveFileImports({ sourceAbsPath: sourceFile, repoRoot, imports, compilerOptions });

    const edge = resolved.find((r) => r.original.specifier === '@/utils/helpers');
    expect(edge).toBeDefined();
    expect(edge!.resolutionMethod).toBe('alias');
    expect(edge!.resolvedRelPath).toBe('src/utils/helpers.ts');
  });

  it('resolves ./utils to src/utils/index.ts (barrel file)', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);
    const resolved = resolveFileImports({ sourceAbsPath: sourceFile, repoRoot, imports, compilerOptions });

    const edge = resolved.find((r) => r.original.specifier === './utils');
    expect(edge).toBeDefined();
    expect(edge!.resolutionMethod).toBe('index');
    expect(edge!.resolvedRelPath).toBe('src/utils/index.ts');
  });

  it('resolves ./api.js to src/api.ts (.js → .ts mapping)', () => {
    const imports = extractImports(sourceFile).imports;
    const compilerOptions = loadCompilerOptions(repoRoot);
    const resolved = resolveFileImports({ sourceAbsPath: sourceFile, repoRoot, imports, compilerOptions });

    const edge = resolved.find((r) => r.original.specifier === './api.js');
    expect(edge).toBeDefined();
    expect(edge!.resolvedRelPath).toBe('src/api.ts');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unresolvable import — recorded as 'unresolved', never dropped
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveFileImports — unresolvable imports', () => {
  it('records a completely invalid specifier as unresolved (not dropped)', async () => {
    const { initParser: _init } = await import('../src/parser/parser.js');
    const compilerOptions = loadCompilerOptions(
      path.join(FIXTURES, 'fixture-simple')
    );

    // We pass a hand-crafted import record that can never resolve
    const fakeImports = [
      { specifier: '__DOES_NOT_EXIST_ANYWHERE__', line: 99, kind: 'static' as const },
    ];

    const resolved = resolveFileImports({
      sourceAbsPath: path.join(FIXTURES, 'fixture-simple', 'src', 'index.ts'),
      repoRoot: path.join(FIXTURES, 'fixture-simple'),
      imports: fakeImports,
      compilerOptions,
    });

    expect(resolved.length).toBe(1);
    expect(resolved[0]!.resolutionMethod).toBe('unresolved');
    expect(resolved[0]!.resolvedRelPath).toBeNull();
    expect(resolved[0]!.isExternal).toBe(false);
  });
});
