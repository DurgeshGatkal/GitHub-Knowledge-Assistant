/**
 * analysisJob.ts — The background job that runs the analyser.
 *
 * Wires the cache + the analyzer together:
 *   1. If (owner, repo, sha) is already cached, return it instantly.
 *   2. Otherwise call analyzeRemote() (Downloads tarball → parse → resolve → graph).
 *   3. Write the result into the cache so it is never recomputed.
 *
 * This is the seam between the new web layer and the completed engine.
 */

import type { GraphAnalysis, analyzeRemote } from '@repo/analyzer';
import type { GraphCache } from '../cache/graphCache.js';

export interface AnalysisJobDeps {
  /** The analyzer's remote entry point (mocked in tests). */
  analyzeRemote: typeof analyzeRemote;
  /** Persisted cache. */
  cache: GraphCache;
}

/**
 * Builds the job handler passed to the queue processor.
 */
export function createAnalysisJobHandler(deps: AnalysisJobDeps) {
  const { analyzeRemote, cache } = deps;

  return async function analyzeJob(job: {
    owner: string;
    repo: string;
    sha: string;
  }): Promise<GraphAnalysis> {
    const { owner, repo, sha } = job;

    // ── Cache hit: never re-analyse an immutable commit ─────────────────────
    const cached = await cache.get(owner, repo, sha);
    if (cached) {
      return cached;
    }

    // ── Cache miss: run the full pipeline ───────────────────────────────────
    const graph = await analyzeRemote({ owner, repo, sha });

    // ── Store for next time ─────────────────────────────────────────────────
    await cache.set(owner, repo, sha, graph);
    return graph;
  }
}
