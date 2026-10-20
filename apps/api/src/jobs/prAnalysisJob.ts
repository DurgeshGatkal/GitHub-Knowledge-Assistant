/**
 * prAnalysisJob.ts — Background job that runs PR impact analysis.
 *
 * For a pull request, this job:
 *   1. Builds the base graph (analyzeRemote at base SHA)
 *   2. Builds the head graph (analyzeRemote at head SHA)
 *   3. Runs impact analysis on both graphs with the changed files
 *   4. Returns the PR analysis result (ImpactAnalysis + PR metadata)
 */

import type {
  GraphAnalysis,
  ImpactAnalysis,
  analyzeRemote,
  analyzeImpact,
} from '@repo/analyzer';
import type { PRChangedFile } from '@repo/analyzer';

export interface PRAnalysisDeps {
  /** The analyzer's remote entry point (mocked in tests). */
  analyzeRemote: typeof analyzeRemote;
  /** The impact analysis entry point (mocked in tests). */
  analyzeImpact: typeof analyzeImpact;
}

export interface PRAnalysisResult {
  /** Pull request number */
  number: number;
  /** Pull request title */
  title: string;
  /** Pull request state */
  state: string;
  /** Head commit SHA */
  headSha: string;
  /** Base commit SHA */
  baseSha: string;
  /** Changed files */
  changedFiles: PRChangedFile[];
  /** Impact analysis result */
  impact: ImpactAnalysis;
}

/**
 * Builds the PR analysis job handler.
 */
export function createPRAnalysisJobHandler(deps: PRAnalysisDeps) {
  const { analyzeRemote, analyzeImpact } = deps;

  return async function analyzePRJob(job: {
    owner: string;
    repo: string;
    sha: string; // head SHA
    prNumber: number;
    baseSha: string;
    changedFiles: PRChangedFile[];
    prTitle: string;
    prState: string;
  }): Promise<PRAnalysisResult> {
    const {
      owner,
      repo,
      sha: headSha,
      prNumber,
      baseSha,
      changedFiles,
      prTitle,
      prState,
    } = job;

    // ── Build base graph ──────────────────────────────────────────────────
    const baseGraph = await analyzeRemote({ owner, repo, sha: baseSha });

    // ── Build head graph ──────────────────────────────────────────────────
    const headGraph = await analyzeRemote({ owner, repo, sha: headSha });

    // ── Run impact analysis ───────────────────────────────────────────────
    const impact = analyzeImpact(headGraph, {
      changedFiles: changedFiles.map((f) => f.filename),
      depthLimit: 3,
    });

    return {
      number: prNumber,
      title: prTitle,
      state: prState,
      headSha,
      baseSha,
      changedFiles,
      impact,
    };
  }
}
