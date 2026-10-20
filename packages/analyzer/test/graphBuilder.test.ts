/**
 * graphBuilder.test.ts
 *
 * Verifies that buildGraph() produces the correct node/edge structure.
 * We run the full local pipeline against fixture repos (parse → resolve → graph)
 * so each test exercises real data, not mocks.
 *
 * WHY use analyzeLocal() instead of calling buildGraph() directly?
 *   buildGraph() needs resolved imports, which come from the resolver, which
 *   needs parsed imports. Calling analyzeLocal() exercises the full pipeline
 *   and gives us confidence that all three stages integrate correctly.
 *
 * Tests map exactly to the plan's success criteria for Days 4–6:
 *   "Results on 2–3 repositories match what you check by hand."
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLocal } from '../src/pipeline.js';
import { buildGraph } from '../src/graph/graphBuilder.js';
import type { ResolvedImport } from '../src/resolver/resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');

// ─────────────────────────────────────────────────────────────────────────────
// fixture-simple: node and edge structure
// ─────────────────────────────────────────────────────────────────────────────

describe('buildGraph — fixture-simple', () => {
  it('includes all source files as graph nodes', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    const nodeIds = analysis.nodes.map((n) => n.id);

    // We know exactly which files exist in fixture-simple:
    expect(nodeIds).toContain('src/index.ts');
    expect(nodeIds).toContain('src/price.ts');
    expect(nodeIds).toContain('src/types.ts');
    expect(nodeIds).toContain('src/formatter.ts');
    expect(nodeIds).toContain('src/config.ts');
    expect(nodeIds).toContain('src/discount.ts');
    expect(nodeIds).toContain('utils/helpers.ts');
  });

  it('creates a directed edge from index.ts to price.ts', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    const edge = analysis.edges.find(
      (e) => e.source === 'src/index.ts' && e.target === 'src/price.ts'
    );
    expect(edge).toBeDefined();

    // Verify all required edge attributes from the plan (Section 6 / Step 6)
    expect(edge!.attributes.from).toBe('src/index.ts');
    expect(edge!.attributes.to).toBe('src/price.ts');
    expect(edge!.attributes.importLine).toBe(6);              // line 6 in index.ts
    expect(edge!.attributes.specifier).toBe('./price');
    expect(edge!.attributes.kind).toBe('static');
    expect(edge!.attributes.resolutionMethod).toBe('relative');
  });

  it('creates edge from price.ts to formatter.ts (re-export)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    const edge = analysis.edges.find(
      (e) => e.source === 'src/price.ts' && e.target === 'src/formatter.ts'
    );
    expect(edge).toBeDefined();
    expect(edge!.attributes.kind).toBe('reexport');
    expect(edge!.attributes.specifier).toBe('./formatter');
  });

  it('creates edge from price.ts to config.ts (require)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    const edge = analysis.edges.find(
      (e) => e.source === 'src/price.ts' && e.target === 'src/config.ts'
    );
    expect(edge).toBeDefined();
    expect(edge!.attributes.kind).toBe('require');
  });

  it('creates edge from price.ts to discount.ts (dynamic import)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    const edge = analysis.edges.find(
      (e) => e.source === 'src/price.ts' && e.target === 'src/discount.ts'
    );
    expect(edge).toBeDefined();
    expect(edge!.attributes.kind).toBe('dynamic');
  });

  it('does NOT include "react" as a graph node (external import excluded)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    const nodeIds = analysis.nodes.map((n) => n.id);
    expect(nodeIds).not.toContain('react');
    // External count should be > 0 (we skipped the react imports)
    expect(analysis.stats.externalImportsSkipped).toBeGreaterThan(0);
  });

  it('stats are consistent with nodes and edges', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-simple'),
    });

    expect(analysis.stats.totalFiles).toBe(analysis.nodes.length);
    expect(analysis.stats.totalEdges).toBe(analysis.edges.length);
    expect(analysis.stats.unresolvedCount).toBe(analysis.unresolvedImports.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fixture-aliases: alias, barrel, .js → .ts edges
// ─────────────────────────────────────────────────────────────────────────────

describe('buildGraph — fixture-aliases', () => {
  it('creates alias edge: index.ts → src/utils/helpers.ts', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-aliases'),
    });

    const edge = analysis.edges.find(
      (e) =>
        e.source === 'src/index.ts' &&
        e.target === 'src/utils/helpers.ts' &&
        e.attributes.resolutionMethod === 'alias'
    );
    expect(edge).toBeDefined();
    expect(edge!.attributes.specifier).toBe('@/utils/helpers');
  });

  it('creates barrel edge: index.ts → src/utils/index.ts', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-aliases'),
    });

    const edge = analysis.edges.find(
      (e) =>
        e.source === 'src/index.ts' &&
        e.target === 'src/utils/index.ts' &&
        e.attributes.resolutionMethod === 'index'
    );
    expect(edge).toBeDefined();
    expect(edge!.attributes.specifier).toBe('./utils');
  });

  it('creates .js-to-.ts edge: index.ts → src/api.ts', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-aliases'),
    });

    const edge = analysis.edges.find(
      (e) => e.source === 'src/index.ts' && e.target === 'src/api.ts'
    );
    expect(edge).toBeDefined();
    expect(edge!.attributes.specifier).toBe('./api.js');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fixture-circular: cycles stored without infinite loops
// ─────────────────────────────────────────────────────────────────────────────

describe('buildGraph — fixture-circular', () => {
  it('builds the graph without throwing (no infinite loop)', async () => {
    // If the graph builder doesn't handle cycles, this will hang or crash.
    // The test passing is itself proof cycle safety works.
    await expect(
      analyzeLocal({ repoPath: path.join(FIXTURES, 'fixture-circular') })
    ).resolves.toBeDefined();
  });

  it('stores both edges of the 2-node cycle (a→b and b→a)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-circular'),
    });

    // a imports b
    const aToB = analysis.edges.find(
      (e) => e.source === 'a.ts' && e.target === 'b.ts'
    );
    expect(aToB).toBeDefined();

    // b imports a (the cycle closer)
    const bToA = analysis.edges.find(
      (e) => e.source === 'b.ts' && e.target === 'a.ts'
    );
    expect(bToA).toBeDefined();
  });

  it('stores all three edges of the 3-node cycle (c→d→e→c)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-circular'),
    });

    const cToD = analysis.edges.find((e) => e.source === 'c.ts' && e.target === 'd.ts');
    const dToE = analysis.edges.find((e) => e.source === 'd.ts' && e.target === 'e.ts');
    const eToC = analysis.edges.find((e) => e.source === 'e.ts' && e.target === 'c.ts');

    expect(cToD).toBeDefined();
    expect(dToE).toBeDefined();
    expect(eToC).toBeDefined();
  });

  it('has zero unresolved imports in fixture-circular (all paths resolve)', async () => {
    const analysis = await analyzeLocal({
      repoPath: path.join(FIXTURES, 'fixture-circular'),
    });

    // All imports are .js → .ts resolvable; none should be unresolved
    expect(analysis.unresolvedImports.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: same file imported twice from the same source
// ─────────────────────────────────────────────────────────────────────────────

describe('buildGraph — parallel edges', () => {
  it('keeps one edge per import statement when the same target is imported twice', () => {
    const makeResolved = (
      line: number,
      kind: ResolvedImport['original']['kind']
    ): ResolvedImport => ({
      original: { specifier: './types', line, kind },
      resolvedAbsPath: '/repo/source/types.ts',
      resolvedRelPath: 'source/types.ts',
      resolutionMethod: 'relative',
      isExternal: false,
    });

    const analysis = buildGraph({
      owner: 'o',
      repo: 'r',
      sha: 'a'.repeat(40),
      fileResults: [
        {
          file: {
            relativePath: 'source/index.ts',
            absolutePath: '/repo/source/index.ts',
            sizeBytes: 10,
          },
          resolvedImports: [makeResolved(1, 'static'), makeResolved(2, 'reexport')],
          parseError: false,
        },
        {
          file: {
            relativePath: 'source/types.ts',
            absolutePath: '/repo/source/types.ts',
            sizeBytes: 10,
          },
          resolvedImports: [],
          parseError: false,
        },
      ],
    });

    // Both import statements must survive (this used to throw inside graphology
    // because a simple DirectedGraph rejects parallel edges).
    expect(analysis.edges).toHaveLength(2);
    expect(analysis.stats.totalEdges).toBe(2);
    expect(analysis.edges.map((e) => e.attributes.importLine).sort()).toEqual([1, 2]);
  });
});
