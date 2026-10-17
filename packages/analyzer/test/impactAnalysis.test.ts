/**
 * impactAnalysis.test.ts
 *
 * Tests for Days 7–8:
 *   - Day 7: the depth-limited reverse impact traversal.
 *   - Day 8: finding classification, evidence chains and test matching.
 *
 * WHY run the full pipeline?
 *   Impact analysis consumes a real GraphAnalysis. We build it with
 *   analyzeLocal() against the fixture repos — exactly like graphBuilder.test.ts
 *   — so every expectation below is hand-checkable against the fixture sources.
 *
 * Fixture note: fixture-simple gained three files for these tests:
 *   src/price.test.ts  — imports affected code   (import-based match → Confirmed)
 *   src/config.test.ts — sits beside config.ts   (name-proximity match → Inferred)
 *   src/loader.ts      — contains an unresolved import (→ Unverified)
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeLocal } from '../src/pipeline.js';
import { analyzeImpact, reverseTraverse } from '../src/impact/index.js';
import type { GraphAnalysis } from '../src/graph/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', '..', '..', 'fixtures');

const SIMPLE = path.join(FIXTURES, 'fixture-simple');
const ALIASES = path.join(FIXTURES, 'fixture-aliases');
const CIRCULAR = path.join(FIXTURES, 'fixture-circular');

// Building a graph is the slow part, and the pipeline is deterministic, so we
// analyse each fixture once and reuse the result across the tests.
const graphCache = new Map<string, Promise<GraphAnalysis>>();
function graphFor(repoPath: string): Promise<GraphAnalysis> {
  let promise = graphCache.get(repoPath);
  if (!promise) {
    promise = analyzeLocal({ repoPath });
    graphCache.set(repoPath, promise);
  }
  return promise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Day 7 — reverse impact traversal
// ─────────────────────────────────────────────────────────────────────────────

describe('Day 7 — reverse impact traversal (fixture-simple)', () => {
  it('finds direct and transitive importers with depths and evidence chains', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/price.ts'] });

    expect(impact.changedFiles).toEqual(['src/price.ts']);
    expect(impact.affectedFiles.map((f) => f.file)).toEqual([
      'src/index.ts',
      'src/price.test.ts',
    ]);

    // Direct importer: index.ts imports './price' on line 6.
    const direct = impact.affectedFiles.find((f) => f.file === 'src/index.ts')!;
    expect(direct.status).toBe('confirmed');
    expect(direct.depth).toBe(1);
    expect(direct.viaChangedFiles).toEqual(['src/price.ts']);
    expect(direct.chain).toEqual([
      {
        from: 'src/index.ts',
        to: 'src/price.ts',
        importLine: 6,
        kind: 'static',
        specifier: './price',
      },
    ]);

    // Transitive importer: price.test.ts imports './index' on line 4.
    const transitive = impact.affectedFiles.find(
      (f) => f.file === 'src/price.test.ts'
    )!;
    expect(transitive.status).toBe('confirmed');
    expect(transitive.depth).toBe(2);
    expect(transitive.chain).toHaveLength(2);
    expect(transitive.chain[1]).toEqual({
      from: 'src/price.test.ts',
      to: 'src/index.ts',
      importLine: 4,
      kind: 'static',
      specifier: './index',
    });

    // Seeds (1 changed file) + 2 reached files.
    expect(impact.stats.visitedCount).toBe(3);
    expect(impact.stats.depthLimit).toBe(3);
  });

  it('never lists a changed file as affected', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/index.ts'] });

    expect(impact.affectedFiles.map((f) => f.file)).toEqual([
      'src/price.test.ts',
    ]);
    expect(impact.affectedFiles.some((f) => f.file === 'src/index.ts')).toBe(
      false
    );
  });

  it('follows alias and barrel edges back to the importer (fixture-aliases)', async () => {
    const graph = await graphFor(ALIASES);
    const impact = analyzeImpact(graph, {
      changedFiles: ['src/utils/helpers.ts'],
    });

    expect(impact.affectedFiles.map((f) => f.file)).toEqual([
      'src/index.ts',
      'src/utils/index.ts',
    ]);
    for (const finding of impact.affectedFiles) {
      expect(finding.status).toBe('confirmed');
      expect(finding.depth).toBe(1);
    }

    const viaAlias = impact.affectedFiles.find(
      (f) => f.file === 'src/index.ts'
    )!;
    expect(viaAlias.chain[0]!.specifier).toBe('@/utils/helpers');

    const viaBarrel = impact.affectedFiles.find(
      (f) => f.file === 'src/utils/index.ts'
    )!;
    expect(viaBarrel.chain[0]!.specifier).toBe('./helpers');
    expect(viaBarrel.chain[0]!.kind).toBe('reexport');
  });

  it('walks a cycle without looping and keeps the changed file out (fixture-circular)', async () => {
    const graph = await graphFor(CIRCULAR);
    const impact = analyzeImpact(graph, { changedFiles: ['c.ts'] });

    expect(impact.affectedFiles.map((f) => f.file)).toEqual(['d.ts', 'e.ts']);
    expect(
      impact.affectedFiles.every((f) => f.status === 'confirmed')
    ).toBe(true);
    expect(impact.affectedFiles.find((f) => f.file === 'e.ts')!.depth).toBe(1);
    expect(impact.affectedFiles.find((f) => f.file === 'd.ts')!.depth).toBe(2);
    // The cycle leads back to c.ts, but a changed file is never "affected".
    expect(impact.affectedFiles.some((f) => f.file === 'c.ts')).toBe(false);
  });

  it('marks files that are only reachable beyond the depth limit as unverified', async () => {
    const graph = await graphFor(CIRCULAR);
    const impact = analyzeImpact(graph, {
      changedFiles: ['c.ts'],
      depthLimit: 1,
    });

    const direct = impact.affectedFiles.find((f) => f.file === 'e.ts')!;
    expect(direct.status).toBe('confirmed');
    expect(direct.depth).toBe(1);

    const beyond = impact.affectedFiles.find((f) => f.file === 'd.ts')!;
    expect(beyond.status).toBe('unverified');
    expect(beyond.depth).toBe(2);
    expect(beyond.chain).toHaveLength(2);

    expect(impact.stats.beyondDepthCount).toBe(1);
    expect(impact.stats.unverifiedCount).toBe(1);
  });

  it('exposes the raw traversal with seeds at depth 0', async () => {
    const graph = await graphFor(SIMPLE);
    const traversal = reverseTraverse(graph, { changedFiles: ['src/price.ts'] });

    expect(traversal.depthLimit).toBe(3);
    expect(traversal.visited.map((n) => [n.file, n.depth])).toEqual([
      ['src/index.ts', 1],
      ['src/price.test.ts', 2],
      ['src/price.ts', 0],
    ]);
    expect(traversal.beyond).toEqual([]);
    expect(traversal.visitedCount).toBe(3);
  });

  it('produces identical results for the same inputs (deterministic)', async () => {
    const graph = await graphFor(SIMPLE);
    const first = analyzeImpact(graph, { changedFiles: ['src/price.ts'] });
    const second = analyzeImpact(graph, { changedFiles: ['src/price.ts'] });

    expect(second).toEqual(first);
  });

  it('returns an empty report for an empty changed list', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: [] });

    expect(impact.changedFiles).toEqual([]);
    expect(impact.affectedFiles).toEqual([]);
    expect(impact.testMatches).toEqual([]);
    expect(impact.unresolvedLinks).toEqual([]);
    expect(impact.stats.visitedCount).toBe(0);
    expect(impact.stats.confirmedCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Day 8 — classification, evidence chains and test matching
// ─────────────────────────────────────────────────────────────────────────────

describe('Day 8 — classification and test matching', () => {
  it('labels a test that imports affected code as confirmed', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/index.ts'] });

    expect(impact.testMatches).toEqual([
      {
        testFile: 'src/price.test.ts',
        status: 'confirmed',
        rules: ['imports-affected-code'],
        reason: 'imports affected code through resolved import edges',
        viaChangedFiles: ['src/index.ts'],
      },
    ]);
    expect(impact.stats.confirmedCount).toBe(1);
    expect(impact.stats.inferredCount).toBe(0);
  });

  it('suggests a sibling test by name as inferred', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/config.ts'] });

    // Name proximity: config.test.ts sits beside the changed config.ts.
    const inferred = impact.testMatches.find(
      (m) => m.testFile === 'src/config.test.ts'
    )!;
    expect(inferred.status).toBe('inferred');
    expect(inferred.rules).toEqual(['name-proximity']);
    expect(inferred.viaChangedFiles).toEqual(['src/config.ts']);
    expect(inferred.reason).toBe('sits beside changed file src/config.ts');

    // Import-based: price.test.ts imports affected code (reached transitively).
    const confirmed = impact.testMatches.find(
      (m) => m.testFile === 'src/price.test.ts'
    )!;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.rules).toEqual(['imports-affected-code']);

    expect(impact.stats.inferredCount).toBe(1);
  });

  it('merges the two rules when a test matches both', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/price.ts'] });

    const match = impact.testMatches.find(
      (m) => m.testFile === 'src/price.test.ts'
    )!;
    expect(match.status).toBe('confirmed'); // stronger rule wins
    expect(match.rules).toEqual(['imports-affected-code', 'name-proximity']);
    expect(match.reason).toContain('imports affected code');
    expect(match.reason).toContain('sits beside changed file src/price.ts');
  });

  it('surfaces unresolved links in relevant files as unverified', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/loader.ts'] });

    expect(impact.affectedFiles).toEqual([]);
    expect(impact.unresolvedLinks).toEqual([
      {
        sourceFile: 'src/loader.ts',
        specifier: './missing-module',
        importLine: 4,
        kind: 'dynamic',
      },
    ]);
    expect(impact.stats.unresolvedLinkCount).toBe(1);
    expect(impact.stats.unverifiedCount).toBe(1);
  });

  it('merges evidence when several changed files reach the same file', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, {
      changedFiles: ['src/types.ts', 'src/price.ts'],
    });

    const index = impact.affectedFiles.find((f) => f.file === 'src/index.ts')!;
    expect(index.viaChangedFiles).toEqual(['src/price.ts', 'src/types.ts']);

    const test = impact.affectedFiles.find(
      (f) => f.file === 'src/price.test.ts'
    )!;
    expect(test.viaChangedFiles).toEqual(['src/price.ts', 'src/types.ts']);
  });

  it('keeps the stats consistent with the findings', async () => {
    const graph = await graphFor(SIMPLE);
    const impact = analyzeImpact(graph, { changedFiles: ['src/config.ts'] });

    const unverifiedFiles = impact.affectedFiles.filter(
      (f) => f.status === 'unverified'
    ).length;

    expect(impact.stats.confirmedCount).toBe(
      impact.affectedFiles.filter((f) => f.status === 'confirmed').length
    );
    expect(impact.stats.beyondDepthCount).toBe(unverifiedFiles);
    expect(impact.stats.unverifiedCount).toBe(
      unverifiedFiles + impact.unresolvedLinks.length
    );
  });
});
