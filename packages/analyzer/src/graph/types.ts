/**
 * types.ts
 *
 * Shared TypeScript interfaces for the dependency graph.
 *
 * These types implement the exact data model described in the project plan
 * (Section 6 / Step 6 & Step 9). They are used by the graph builder, the
 * API server, and eventually the extension UI.
 *
 * Keeping types in a separate file means the graph builder, CLI, and tests
 * can all import from one place — no circular imports between modules.
 */

import type { ResolutionMethod } from '../resolver/resolver.js';

// ---------------------------------------------------------------------------
// Node attributes
// ---------------------------------------------------------------------------

/**
 * Data stored on every node (file) in the dependency graph.
 * A node represents one source file in the repository.
 */
export interface NodeAttributes {
  /** Path relative to the repo root, e.g. 'src/utils/price.ts' */
  filePath: string;
  /** File size in bytes (from the tarball entry or local stat) */
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Edge attributes
// ---------------------------------------------------------------------------

/**
 * Data stored on every directed edge (import relationship) in the graph.
 * An edge A → B means "file A imports file B".
 *
 * All fields are taken verbatim from the project plan (Section 6 / Step 6).
 */
export interface EdgeAttributes {
  /** The importing file (relative path) */
  from: string;
  /** The imported file (relative path) */
  to: string;
  /** 1-based line number of the import statement in the source file */
  importLine: number;
  /** The exact specifier text as it appears in the source, e.g. './price' */
  specifier: string;
  /** The kind of import: static, dynamic, reexport, or require */
  kind: 'static' | 'dynamic' | 'reexport' | 'require';
  /**
   * How the specifier was resolved:
   *   - 'relative'   — './foo' resolved to foo.ts
   *   - 'alias'      — '@/utils' expanded via tsconfig paths
   *   - 'index'      — './utils' resolved to utils/index.ts (barrel)
   *   - 'baseUrl'    — bare specifier resolved via tsconfig baseUrl
   *   - 'unresolved' — the analyzer could not resolve this import (Unverified per plan)
   */
  resolutionMethod: ResolutionMethod;
}

// ---------------------------------------------------------------------------
// Unresolved import record
// ---------------------------------------------------------------------------

/**
 * An import the resolver could not resolve to a real file.
 * Kept separate from the graph edges so the UI can show the Unverified count.
 *
 * Per plan: "The side panel shows the count of unverified links at the top."
 */
export interface UnresolvedImport {
  /** The file that contains this import */
  sourceFile: string;
  /** The raw specifier text (e.g. a dynamic require(variable) result) */
  specifier: string;
  /** Line number in the source file */
  importLine: number;
  /** Import kind */
  kind: 'static' | 'dynamic' | 'reexport' | 'require';
}

// ---------------------------------------------------------------------------
// Full graph analysis result
// ---------------------------------------------------------------------------

/**
 * The complete result of analyzing a repository.
 * Returned by the pipeline and consumed by the API server / CLI.
 */
export interface GraphAnalysis {
  /** GitHub owner/repo identifiers */
  owner: string;
  repo: string;
  /** The exact commit SHA the tarball was downloaded at */
  sha: string;
  /**
   * Serializable representation of the graph.
   * We export plain arrays rather than the graphology object so the result
   * can be JSON-serialized and sent over HTTP to the extension.
   */
  nodes: Array<{ id: string; attributes: NodeAttributes }>;
  edges: Array<{ source: string; target: string; attributes: EdgeAttributes }>;
  /** All imports the resolver could not follow — shown as Unverified in the UI */
  unresolvedImports: UnresolvedImport[];
  /** Stats shown in the CLI summary and API response */
  stats: {
    totalFiles: number;
    totalEdges: number;
    unresolvedCount: number;
    externalImportsSkipped: number;
    parseErrors: number;
  };
}
