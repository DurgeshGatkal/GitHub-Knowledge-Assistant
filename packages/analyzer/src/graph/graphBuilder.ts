/**
 * graphBuilder.ts
 *
 * Constructs the directed dependency graph using graphology.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY graphology?
 * ─────────────────────────────────────────────────────────────────────────────
 * graphology is the JavaScript equivalent of Python's NetworkX. It provides:
 *   - Directed graphs with typed node/edge attributes
 *   - Built-in support for multiple edges between the same pair of nodes
 *     (a file can import another file multiple times with different specifiers)
 *   - Fast adjacency lookups needed for the reverse BFS in Days 7–8
 *   - JSON serialisation built in
 *
 * graphology stores edges in a map — it does NOT crash on cycles. The cycle
 * concern (circular imports like a→b→a) only applies to TRAVERSAL algorithms,
 * not to graph storage. We handle cycle safety in traversal with a visited Set.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this module does:
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Receives the list of filtered source files and their resolved imports
 *   2. Adds one node per source file
 *   3. Adds one directed edge per resolved intra-repo import
 *   4. Skips external (node_modules) imports — they are not in the graph
 *   5. Records unresolvable imports separately as UnresolvedImport[]
 *   6. Returns a plain GraphAnalysis (JSON-serialisable) for the API / CLI
 */

import DirectedGraph from 'graphology';
import type { NodeAttributes, EdgeAttributes, UnresolvedImport, GraphAnalysis } from './types.js';
import type { FileEntry } from '../fetcher/fileFilter.js';
import type { ResolvedImport } from '../resolver/resolver.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildGraphInput {
  owner: string;
  repo: string;
  sha: string;
  /**
   * Every source file that passed the file filter.
   * Each entry must also carry its resolved imports.
   */
  fileResults: Array<{
    file: FileEntry;
    resolvedImports: ResolvedImport[];
    parseError: boolean;
  }>;
}

/**
 * Builds the dependency graph from resolved imports and returns the full
 * GraphAnalysis result.
 *
 * Design rules enforced here:
 *  - External imports (node_modules) are SKIPPED from the graph.
 *  - Unresolvable imports are collected in unresolvedImports[], never dropped.
 *  - Duplicate edges (same from→to with different specifiers) are allowed:
 *    graphology auto-generates unique edge keys for multi-edges.
 *  - Circular imports are stored normally; traversal guards are the caller's job.
 */
export function buildGraph(input: BuildGraphInput): GraphAnalysis {
  const { owner, repo, sha, fileResults } = input;

  // Use graphology's DirectedGraph with our typed attributes.
  // MultiDirectedGraph would allow parallel edges but DirectedGraph is simpler
  // and sufficient: we generate unique edge IDs ourselves for multi-edges.
  const graph = new DirectedGraph<NodeAttributes, EdgeAttributes>();

  const unresolvedImports: UnresolvedImport[] = [];
  let externalSkipped = 0;
  let parseErrors = 0;

  // ── Pass 1: Add all file nodes ────────────────────────────────────────────
  //
  // We add ALL analysed files as nodes first, even files that have no imports.
  // A file can be a leaf (imported by others but imports nothing itself), and
  // it should still appear in the graph so the UI can show it.
  //
  // Node key = relative path (e.g. 'src/utils/price.ts')
  // This is stable across runs for the same repo/SHA.
  for (const { file, parseError } of fileResults) {
    if (parseError) {
      parseErrors++;
      continue; // Don't add nodes for files we couldn't parse
    }
    const nodeId = file.relativePath;
    if (!graph.hasNode(nodeId)) {
      graph.addNode(nodeId, {
        filePath: file.relativePath,
        sizeBytes: file.sizeBytes,
      });
    }
  }

  // ── Pass 2: Add directed edges from resolved imports ──────────────────────
  //
  // Edge direction:  source → target  means "source imports target".
  // We use `mergeEdge` with a deterministic key so that re-running the builder
  // on the same data is idempotent (same edges, no duplicates).
  for (const { file, resolvedImports, parseError } of fileResults) {
    if (parseError) continue;

    const sourceId = file.relativePath;

    for (const resolved of resolvedImports) {
      // ── External import: skip from graph ───────────────────────────────
      //
      // WHY: We only map intra-repo dependencies. 'react', 'lodash', etc.
      // are not files in the repo and adding them as nodes would pollute
      // the graph with thousands of external nodes.
      if (resolved.isExternal) {
        externalSkipped++;
        continue;
      }

      // ── Unresolvable import: record as Unverified ──────────────────────
      //
      // Per plan: "Unresolvable paths … are recorded explicitly as
      // Unverified, not silently dropped."
      if (resolved.resolutionMethod === 'unresolved') {
        unresolvedImports.push({
          sourceFile: sourceId,
          specifier: resolved.original.specifier,
          importLine: resolved.original.line,
          kind: resolved.original.kind,
        });
        continue;
      }

      // ── Resolved intra-repo import: add edge ──────────────────────────
      const targetId = resolved.resolvedRelPath!;

      // Ensure the target node exists. It might not if the target file was
      // filtered out (e.g., a .d.ts file) — in that case we still add an
      // edge stub so the import is visible in the graph.
      if (!graph.hasNode(targetId)) {
        graph.addNode(targetId, {
          filePath: targetId,
          sizeBytes: 0, // Unknown — file was not in the analyzed set
        });
      }

      // Deterministic edge key: prevents duplicates on repeated builds.
      // Format: "source::target::line" — unique per import statement.
      const edgeKey = `${sourceId}::${targetId}::${resolved.original.line}`;

      if (!graph.hasEdge(edgeKey)) {
        graph.addEdgeWithKey(edgeKey, sourceId, targetId, {
          from: sourceId,
          to: targetId,
          importLine: resolved.original.line,
          specifier: resolved.original.specifier,
          kind: resolved.original.kind,
          resolutionMethod: resolved.resolutionMethod,
        });
      }
    }
  }

  // ── Serialise to plain JSON-safe arrays ───────────────────────────────────
  //
  // WHY export plain arrays instead of the graphology instance?
  //   - The API server needs to JSON.stringify() the result and send it to the
  //     extension. graphology objects are not directly JSON-serialisable.
  //   - Tests are simpler to write against plain data than graph methods.
  //   - The Days 7–8 BFS (reverse search) can easily reconstruct a graphology
  //     instance from these arrays if needed.
  const nodes = graph.nodes().map((id) => ({
    id,
    attributes: graph.getNodeAttributes(id),
  }));

  const edges = graph.edges().map((edgeKey) => ({
    source: graph.source(edgeKey),
    target: graph.target(edgeKey),
    attributes: graph.getEdgeAttributes(edgeKey),
  }));

  return {
    owner,
    repo,
    sha,
    nodes,
    edges,
    unresolvedImports,
    stats: {
      totalFiles: nodes.length,
      totalEdges: edges.length,
      unresolvedCount: unresolvedImports.length,
      externalImportsSkipped: externalSkipped,
      parseErrors,
    },
  };
}
