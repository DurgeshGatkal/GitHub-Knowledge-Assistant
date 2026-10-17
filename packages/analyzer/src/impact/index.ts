/**
 * index.ts
 *
 * Public entry point for change-impact analysis (Days 7–8).
 *
 * `analyzeImpact()` wires the three stages together:
 *   1. reverseTraverse   (Day 7) — depth-limited reverse BFS
 *   2. classifyFindings  (Day 8) — labels, evidence chains, unresolved links
 *   3. matchTests        (Day 8) — relevant tests
 *
 * It takes an already-built GraphAnalysis (from pipeline.analyzeLocal() or
 * pipeline.analyzeRemote()) plus the list of changed files. The pure analyzer
 * therefore never needs GitHub pull-request APIs — deciding which files a PR
 * changed is the extension/server flow (plan Step 8), not this package.
 */

import type { GraphAnalysis } from '../graph/types.js';
import { reverseTraverse } from './reverseSearch.js';
import { classifyFindings } from './classifyFindings.js';
import { matchTests } from './testMatching.js';
import type {
  AnalyzeImpactOptions,
  ImpactAnalysis,
  ImpactStats,
} from './types.js';

/**
 * Computes the change-impact report for a set of changed files.
 *
 * @param analysis an already-built repository graph
 * @param options  the changed files and an optional depth limit
 */
export function analyzeImpact(
  analysis: GraphAnalysis,
  options: AnalyzeImpactOptions
): ImpactAnalysis {
  const traversal = reverseTraverse(analysis, options);

  const classified = classifyFindings({
    traversal,
    unresolvedImports: analysis.unresolvedImports,
  });

  const testMatches = matchTests({
    nodes: analysis.nodes,
    changedFiles: traversal.changedFiles,
    affectedFiles: classified.affectedFiles,
  });

  const stats: ImpactStats = {
    depthLimit: traversal.depthLimit,
    visitedCount: traversal.visitedCount,
    confirmedCount: classified.counts.confirmed,
    inferredCount: testMatches.filter((match) => match.status === 'inferred')
      .length,
    unverifiedCount:
      classified.counts.unverifiedFiles + classified.counts.unresolvedLinks,
    beyondDepthCount: classified.counts.beyondDepth,
    unresolvedLinkCount: classified.counts.unresolvedLinks,
  };

  return {
    changedFiles: traversal.changedFiles,
    affectedFiles: classified.affectedFiles,
    testMatches,
    unresolvedLinks: classified.unresolvedLinks,
    stats,
  };
}

export {
  reverseTraverse,
  buildReverseAdjacency,
  DEFAULT_DEPTH_LIMIT,
} from './reverseSearch.js';
export { classifyFindings } from './classifyFindings.js';
export { matchTests, isTestFile } from './testMatching.js';
export * from './types.js';
