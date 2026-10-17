/**
 * reverseSearch.ts — Day 7 of the plan
 *
 * The reverse search: starting from the files a change touches, walk the
 * dependency graph BACKWARDS and collect every file that may be affected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY "backwards"?
 * ─────────────────────────────────────────────────────────────────────────────
 * A graph edge is directed "importer → imported": index.ts → price.ts means
 * index.ts imports price.ts. If price.ts changes, the files in danger are the
 * ones that import it — the edges pointing IN. So the search follows incoming
 * edges and asks "who imports me? who imports them?", exactly the wording of
 * the plan (Step 9). This is a breadth-first search over the reverse adjacency.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Rules implemented here (plan Step 9)
 * ─────────────────────────────────────────────────────────────────────────────
 *   - A depth limit (default 3) stops the walk.
 *   - A visited set makes cycles safe: a → b → a must not loop forever. This
 *     module is tested on fixture-circular, which contains a 2-node and a
 *     3-node cycle.
 *   - Changed files are never reported as "affected" (a file does not affect
 *     itself) — they are only the seeds of the search.
 *   - Files exactly one hop beyond the depth limit are returned separately
 *     (`beyond`) so Day 8 can label them Unverified instead of silently
 *     dropping them.
 *
 * This module is a pure graph algorithm: it does not know about labels or
 * evidence wording. Classification is Day 8's job (classifyFindings.ts).
 */

import type { GraphAnalysis } from '../graph/types.js';
import type {
  AnalyzeImpactOptions,
  EvidenceLink,
  ReverseTraversal,
  TraversedFile,
} from './types.js';

/** Default depth limit — the plan suggests "for example 3". */
export const DEFAULT_DEPTH_LIMIT = 3;

/**
 * Builds the reverse adjacency: for every file, the list of files that import
 * it. Keys are imported files; values are the evidence links pointing at them.
 *
 * Built once per analysis and reused for the whole BFS. Links are sorted so the
 * traversal — and therefore the evidence chains — is deterministic for the same
 * graph.
 */
export function buildReverseAdjacency(
  analysis: GraphAnalysis
): Map<string, EvidenceLink[]> {
  const reverse = new Map<string, EvidenceLink[]>();

  for (const edge of analysis.edges) {
    const link: EvidenceLink = {
      from: edge.source,
      to: edge.target,
      importLine: edge.attributes.importLine,
      kind: edge.attributes.kind,
      specifier: edge.attributes.specifier,
    };
    const existing = reverse.get(edge.target);
    if (existing) existing.push(link);
    else reverse.set(edge.target, [link]);
  }

  for (const links of reverse.values()) {
    links.sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.importLine - b.importLine ||
        a.specifier.localeCompare(b.specifier)
    );
  }

  return reverse;
}

/**
 * Runs the depth-limited reverse BFS and returns the raw traversal.
 *
 * Labelling (confirmed / unverified) happens in Day 8, so this stays a pure
 * graph algorithm that can be tested on its own.
 */
export function reverseTraverse(
  analysis: GraphAnalysis,
  options: AnalyzeImpactOptions
): ReverseTraversal {
  const depthLimit = options.depthLimit ?? DEFAULT_DEPTH_LIMIT;
  // Deduplicate and sort so the result never depends on input order.
  const changedFiles = [...new Set(options.changedFiles)].sort();
  const reverse = buildReverseAdjacency(analysis);

  // visited holds every file the BFS reaches, including the changed seeds at
  // depth 0. Each seed is its own "via" file.
  const visited = new Map<string, TraversedFile>();
  for (const file of changedFiles) {
    visited.set(file, { file, depth: 0, chain: [], viaChangedFiles: [file] });
  }

  let frontier = changedFiles.slice();
  let level = 0;

  while (level < depthLimit && frontier.length > 0) {
    level++;
    const next: string[] = [];

    for (const file of frontier) {
      const current = visited.get(file)!;
      for (const link of reverse.get(file) ?? []) {
        const importer = link.from;
        if (visited.has(importer)) continue; // cycle guard / already found
        visited.set(importer, {
          file: importer,
          depth: level,
          chain: [...current.chain, link],
          viaChangedFiles: [...current.viaChangedFiles],
        });
        next.push(importer);
      }
    }

    frontier = next;
  }

  // Anything exactly one hop beyond the limit is reported separately, so Day 8
  // can label it Unverified instead of dropping it (see the plan's quality
  // rule: never present uncertain findings as confirmed).
  const beyond = new Map<string, TraversedFile>();
  for (const file of frontier) {
    const current = visited.get(file)!;
    for (const link of reverse.get(file) ?? []) {
      const importer = link.from;
      if (visited.has(importer) || beyond.has(importer)) continue;
      beyond.set(importer, {
        file: importer,
        depth: level + 1,
        chain: [...current.chain, link],
        viaChangedFiles: [...current.viaChangedFiles],
      });
    }
  }

  const visitedList = [...visited.values()];
  const beyondList = [...beyond.values()];

  propagateViaChangedFiles(reverse, [...visitedList, ...beyondList]);
  sortByFile(visitedList);
  sortByFile(beyondList);

  return {
    changedFiles,
    depthLimit,
    visited: visitedList,
    beyond: beyondList,
    visitedCount: visited.size,
  };
}

/**
 * Unions the `viaChangedFiles` lists across all discovered nodes.
 *
 * WHY a second pass instead of merging during the BFS?
 * During the BFS each node is discovered once — through its shortest path — and
 * copies its `via` list from that single parent. Other changed files may reach
 * the same node through different paths; the union is only complete once the
 * whole tree is known. Every edge goes from depth d to depth d+1, so a single
 * ascending pass propagates every contribution outwards.
 */
function propagateViaChangedFiles(
  reverse: Map<string, EvidenceLink[]>,
  nodes: TraversedFile[]
): void {
  const ordered = [...nodes].sort((a, b) => a.depth - b.depth);
  const byFile = new Map(nodes.map((n) => [n.file, n]));

  for (const node of ordered) {
    for (const link of reverse.get(node.file) ?? []) {
      const importer = byFile.get(link.from);
      // Only propagate outwards (never back into a shallower node / a seed).
      if (!importer || importer.depth <= node.depth) continue;
      for (const via of node.viaChangedFiles) {
        if (!importer.viaChangedFiles.includes(via)) {
          importer.viaChangedFiles.push(via);
        }
      }
    }
  }

  for (const node of nodes) node.viaChangedFiles.sort();
}

function sortByFile(nodes: TraversedFile[]): void {
  nodes.sort((a, b) => a.file.localeCompare(b.file));
}
