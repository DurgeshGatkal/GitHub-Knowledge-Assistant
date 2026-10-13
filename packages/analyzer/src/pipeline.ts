/**
 * pipeline.ts
 *
 * The full analysis pipeline: fetch → extract → parse → resolve → build graph.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY a pipeline orchestrator?
 * ─────────────────────────────────────────────────────────────────────────────
 * Each stage (fetcher, extractor, parser, resolver, graph builder) is a pure
 * module that can be tested in isolation. The pipeline wires them together
 * into a single function call so:
 *   - The CLI only needs one import
 *   - The API server (Days 9–10) calls `runAnalysis()` per job
 *   - Tests can mock individual stages without touching the others
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two modes
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Remote mode  — fetches the repo tarball from GitHub by owner/repo/sha
 *   2. Local mode   — reads from a local directory on disk (for fixture testing)
 *
 * Local mode is critical during development: it lets us verify against the
 * fixture repos without a GitHub token or network call. This is how the plan's
 * criterion "Results on 2–3 repositories match what you check by hand" is met.
 */

import path from 'node:path';
import os from 'node:os';
import { mkdirSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { fetchRepoTarball } from './fetcher/fetcher.js';
import { extractTarball } from './fetcher/extractor.js';
import { shouldAnalyzeFile, type FileEntry } from './fetcher/fileFilter.js';
import { initParser, extractImports } from './parser/parser.js';
import {
  loadCompilerOptions,
  resolveFileImports,
  type ResolvedImport,
} from './resolver/resolver.js';
import { buildGraph } from './graph/graphBuilder.js';
import type { GraphAnalysis } from './graph/types.js';

// ---------------------------------------------------------------------------
// Remote analysis (GitHub tarball)
// ---------------------------------------------------------------------------

export interface RemoteAnalysisOptions {
  owner: string;
  repo: string;
  sha: string;
  githubToken?: string;
}

/**
 * Downloads a GitHub repo at the given SHA, runs the full analysis pipeline,
 * and returns the dependency graph. Temp files are cleaned up on completion.
 */
export async function analyzeRemote(
  options: RemoteAnalysisOptions
): Promise<GraphAnalysis> {
  const { owner, repo, sha, githubToken } = options;

  // -- Stage 1: Download the tarball -----------------------------------------
  // GitHub's tarball endpoint returns the repo at an exact commit SHA.
  // Using a SHA (not 'main') guarantees the result is deterministic and cacheable.
  const { tarballPath, tempDir } = await fetchRepoTarball({
    owner, repo, sha, githubToken,
  });

  const extractDir = path.join(os.tmpdir(), `ghe-pipeline-${Date.now()}`);
  mkdirSync(extractDir, { recursive: true });

  try {
    // -- Stage 2: Extract & filter files ---------------------------------------
    // Only .js/.ts files outside of build folders are extracted.
    const { files } = await extractTarball(tarballPath, extractDir);

    // -- Stages 3–5: Parse, Resolve, Build Graph (shared logic) ---------------
    return await _runCoreAnalysis({ owner, repo, sha, files, repoRoot: extractDir });
  } finally {
    // Always clean up temp directories even if analysis throws
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(extractDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Local analysis (fixture directory)
// ---------------------------------------------------------------------------

export interface LocalAnalysisOptions {
  /** Absolute path to the local repo directory to analyze */
  repoPath: string;
  /** Identifiers used in the graph result  */
  owner?: string;
  repo?: string;
  sha?: string;
}

/**
 * Analyzes a local directory as if it were a GitHub repo.
 * Used by the CLI `--local` flag and by Vitest tests.
 *
 * WHY have a local mode at all?
 *   Testing import resolution requires checking that ./price resolves to price.ts,
 *   @/utils resolves via tsconfig, etc. We can't rely on a GitHub fetch in tests —
 *   too slow, requires a token, and is non-deterministic. Local mode lets tests
 *   and the CLI work entirely offline.
 */
export async function analyzeLocal(
  options: LocalAnalysisOptions
): Promise<GraphAnalysis> {
  const {
    repoPath,
    owner = 'local',
    repo = path.basename(repoPath),
    sha = 'local',
  } = options;

  // Walk the directory and collect all files that pass the filter
  const files: FileEntry[] = [];
  walkDir(repoPath, repoPath, files);

  return _runCoreAnalysis({ owner, repo, sha, files, repoRoot: repoPath });
}

/**
 * Recursively walks a directory and collects FileEntry records for source files.
 */
function walkDir(baseDir: string, dir: string, files: FileEntry[]): void {
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = path.relative(baseDir, abs).replace(/\\/g, '/');
    const stat = statSync(abs);

    if (stat.isDirectory()) {
      walkDir(baseDir, abs, files);
    } else if (shouldAnalyzeFile(rel, stat.size)) {
      files.push({
        relativePath: rel,
        absolutePath: abs,
        sizeBytes: stat.size,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Core analysis (shared by both modes)
// ---------------------------------------------------------------------------

interface CoreAnalysisInput {
  owner: string;
  repo: string;
  sha: string;
  files: FileEntry[];
  repoRoot: string;
}

/**
 * Runs stages 3–5 of the pipeline (parse → resolve → graph) on an already-
 * collected set of FileEntry records. Called by both analyzeRemote and analyzeLocal.
 *
 * Keeping this internal means we avoid duplicating the parse/resolve/build logic.
 */
async function _runCoreAnalysis(input: CoreAnalysisInput): Promise<GraphAnalysis> {
  const { owner, repo, sha, files, repoRoot } = input;

  // -- Stage 3: Initialise Tree-sitter parsers --------------------------------
  // initParser() is idempotent — safe to call multiple times. Internally it
  // guards against re-initialisation with the singleton pattern from parser.ts.
  await initParser();

  // -- Stage 4: Load TypeScript compiler options ------------------------------
  // Read tsconfig.json once for the whole repo. All import resolutions share
  // these options — we don't want to re-parse tsconfig.json for every file.
  const compilerOptions = loadCompilerOptions(repoRoot);

  // -- Stage 5: Per-file: parse → resolve ------------------------------------
  // For each source file:
  //   a) Extract raw import records (Tree-sitter)
  //   b) Resolve each import to a real file path (TS resolver)
  const fileResults: Array<{
    file: FileEntry;
    resolvedImports: ResolvedImport[];
    parseError: boolean;
  }> = [];

  for (const file of files) {
    const parseResult = extractImports(file.absolutePath);

    if (parseResult.parseError) {
      fileResults.push({ file, resolvedImports: [], parseError: true });
      continue;
    }

    // Resolve every import the parser found
    const resolvedImports = resolveFileImports({
      sourceAbsPath: file.absolutePath,
      repoRoot,
      imports: parseResult.imports,
      compilerOptions,
    });

    fileResults.push({ file, resolvedImports, parseError: false });
  }

  // -- Stage 6: Build the dependency graph -----------------------------------
  // The graph builder consumes all per-file results and produces the final
  // GraphAnalysis containing nodes, edges, and unresolved imports.
  return buildGraph({ owner, repo, sha, fileResults });
}
