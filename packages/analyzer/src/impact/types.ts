/**
 * types.ts
 *
 * Shared TypeScript interfaces for pull-request change-impact analysis.
 *
 * These types implement the data model from the project plan:
 *   - Step 9  "Compute the impact (reverse search)"
 *   - Step 10 "Label every finding" (confirmed / inferred / unverified)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Where each of the three labels applies (plan Step 10)
 * ─────────────────────────────────────────────────────────────────────────────
 *   confirmed  — an affected file reached by following RESOLVED import edges
 *                (a real import path exists from a changed file).
 *   unverified — a finding the analyzer could not decide:
 *                  (a) an affected file only reachable BEYOND the depth limit
 *                      ("searched only to depth N"), or
 *                  (b) an unresolved import link found in a relevant file
 *                      (the target could not be resolved at all).
 *   inferred   — a heuristic with no direct import edge. In this phase it
 *                labels test files matched by NAME PROXIMITY only
 *                (e.g. price.test.ts sitting next to price.ts) — exactly the
 *                example the plan gives for "inferred".
 *
 * Design note — one array, not two.
 * The plan speaks of "affected files" and "findings". They are the same thing:
 * one affected file is one finding. We expose a single `affectedFiles` array so
 * the two views can never drift apart.
 */

import type { ImportKind } from '../parser/parser.js';

/** The three labels from the project plan (Step 10). */
export type FindingStatus = 'confirmed' | 'inferred' | 'unverified';

/**
 * One step of an evidence chain.
 * The fields mirror the edge attributes stored by the graph builder
 * (src/graph/types.ts), so every chain link is self-describing: it says which
 * file imports which, on what line, with which specifier.
 */
export interface EvidenceLink {
  /** The importing file (repo-relative path) */
  from: string;
  /** The imported file (repo-relative path) */
  to: string;
  /** 1-based line number of the import statement in `from` */
  importLine: number;
  /** How the import was written: static, dynamic, reexport or require */
  kind: ImportKind;
  /** The exact specifier text from the source, e.g. './price' */
  specifier: string;
}

/**
 * An affected file: a source file that may be affected by the change, together
 * with its label, its evidence chain and the changed files that reach it.
 */
export interface AffectedFile {
  /** Repo-relative path (same identifier scheme as the graph nodes) */
  file: string;
  /** 1 = direct importer of a changed file, 2 = importer of an importer, … */
  depth: number;
  /** The label from the project plan (Step 10) */
  status: FindingStatus;
  /** Every changed file whose reverse search reaches this file */
  viaChangedFiles: string[];
  /**
   * The evidence chain: the import links leading from a changed file to this
   * file, ordered from the changed file outwards. The last link's `from` is
   * always this file.
   */
  chain: EvidenceLink[];
}

/** An import the resolver could not resolve, in a file relevant to the impact. */
export interface UnresolvedLink {
  /** The file that contains this unresolved import */
  sourceFile: string;
  /** The raw specifier text that could not be resolved */
  specifier: string;
  /** 1-based line number of the import */
  importLine: number;
  /** Import kind */
  kind: ImportKind;
}

/** How a test file was matched to the impact. */
export type TestMatchRule = 'imports-affected-code' | 'name-proximity';

/** A test file suggested by the impact analysis. */
export interface TestMatch {
  /** Repo-relative path of the test file */
  testFile: string;
  /** Confirmed / unverified (imports rule) or inferred (name rule) */
  status: FindingStatus;
  /** Every rule that matched this test — a test can match both */
  rules: TestMatchRule[];
  /** Human-readable explanation, safe to show in the UI */
  reason: string;
  /** The changed files that led to this match */
  viaChangedFiles: string[];
}

/** Counters shown in the UI and asserted by tests. */
export interface ImpactStats {
  /** The depth limit used for the search */
  depthLimit: number;
  /** How many files (including the changed seeds) the search visited */
  visitedCount: number;
  /** Affected files proven by resolved import paths */
  confirmedCount: number;
  /** Test files matched only by the name-proximity heuristic */
  inferredCount: number;
  /**
   * Findings the analyzer could not decide: depth-limited affected files plus
   * unresolved links in relevant files. This is the "links the tool could not
   * resolve" number shown at the top of the side panel.
   */
  unverifiedCount: number;
  /** Affected files only reachable beyond the depth limit */
  beyondDepthCount: number;
  /** Unresolved import links found in relevant files */
  unresolvedLinkCount: number;
}

/**
 * The complete result of a change-impact analysis.
 * JSON-safe: consumed by tests now, and by the API server / extension later.
 */
export interface ImpactAnalysis {
  /** The changed files the search started from (deduplicated and sorted) */
  changedFiles: string[];
  /** Every affected file, labelled, with evidence chains (sorted by path) */
  affectedFiles: AffectedFile[];
  /** Test files suggested by the imports rule and/or the name rule */
  testMatches: TestMatch[];
  /** Unresolved links found in relevant files (shown as Unverified) */
  unresolvedLinks: UnresolvedLink[];
  /** Counters (see ImpactStats) */
  stats: ImpactStats;
}

/** Options for `analyzeImpact` / `reverseTraverse`. */
export interface AnalyzeImpactOptions {
  /** Repo-relative paths of the files the change touches */
  changedFiles: string[];
  /** How many import hops to walk backwards (default 3, per the plan) */
  depthLimit?: number;
}

/**
 * A node discovered by the reverse traversal (internal pipeline shape).
 * The BFS also uses this shape for the changed files themselves at depth 0.
 */
export interface TraversedFile {
  file: string;
  depth: number;
  chain: EvidenceLink[];
  viaChangedFiles: string[];
}

/** Raw output of the reverse traversal (Day 7), before labelling (Day 8). */
export interface ReverseTraversal {
  changedFiles: string[];
  depthLimit: number;
  /** Files reached within the depth limit (including changed seeds at depth 0) */
  visited: TraversedFile[];
  /** Files one hop beyond the depth limit — reported as Unverified */
  beyond: TraversedFile[];
  /** Number of distinct files visited (including the changed seeds) */
  visitedCount: number;
}
