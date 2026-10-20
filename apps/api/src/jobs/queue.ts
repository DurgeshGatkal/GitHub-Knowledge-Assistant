/**
 * queue.ts — In-process background job queue.
 *
 * Large repositories take seconds or minutes to analyse, so we never hold an
 * HTTP request open. Instead:
 *   1. The API creates a job and returns its id immediately.
 *   2. A background processor runs the analysis.
 *   3. The extension polls GET /api/jobs/:id every 1–2 s.
 *
 * This matches plan Step 2 ("asynchronous job with polling") and §5.
 */

import type { GraphAnalysis } from '@repo/analyzer';
import type { ImpactAnalysis } from '@repo/analyzer';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobKind = 'repo' | 'pr';

export interface JobRecord {
  /** Unique job id returned to the caller. */
  id: string;
  /** Current lifecycle state. */
  status: JobStatus;
  /** Job kind: 'repo' for repository analysis, 'pr' for pull request analysis. */
  kind: JobKind;
  /** Repository being analysed. */
  owner: string;
  repo: string;
  /** SHA being analysed (for 'pr' jobs, this is the head SHA). */
  sha: string;
  /** PR number (only for 'pr' jobs). */
  prNumber?: number;
  /** Base SHA (only for 'pr' jobs). */
  baseSha?: string;
  /** PR title (only for 'pr' jobs). */
  prTitle?: string;
  /** PR state, e.g. "open" / "closed" (only for 'pr' jobs). */
  prState?: string;
  /** Changed files from the PR (only for 'pr' jobs). */
  changedFiles?: Array<{
    filename: string;
    previous_filename?: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
  }>;
  /** Unix ms the job was created. */
  createdAt: number;
  /** Unix ms the job last changed state. */
  updatedAt: number;
  /** Populated when status === 'done'. */
  result?: GraphAnalysis | ImpactAnalysis | any;
  /** Populated when status === 'failed'. */
  error?: string;
}

export interface JobQueueOptions {
  /** Max jobs to run concurrently (in-process; 1 is safe and simple). */
  concurrency?: number;
}

/**
 * Creates a job queue. `processJob(owner, repo, sha)` performs the actual
 * analysis and returns the GraphAnalysis, or throws on failure.
 */
export function createJobQueue(options: JobQueueOptions = {}) {
  const concurrency = options.concurrency ?? 1;
  const jobs = new Map<string, JobRecord>();
  const running = new Set<string>();
  let processor: ((job: JobRecord) => Promise<any>) | null = null;

  /**
   * Register the analysis handler. Called once at server startup.
   */
  function setProcessor(
    handler: (job: JobRecord) => Promise<any>
  ): void {
    processor = handler;
  }

  /**
   * Create a job in the 'queued' state and return its record.
   * Processing is triggered externally via `tick()`.
   */
  function enqueue(
    owner: string,
    repo: string,
    sha: string,
    opts?: {
      kind?: JobKind;
      prNumber?: number;
      baseSha?: string;
      prTitle?: string;
      prState?: string;
      changedFiles?: JobRecord['changedFiles'];
    }
  ): JobRecord {
    const now = Date.now();
    const id = `${owner}-${repo}-${sha}-${now}`;
    const job: JobRecord = {
      id,
      status: 'queued',
      owner,
      repo,
      sha,
      kind: opts?.kind ?? 'repo',
      prNumber: opts?.prNumber,
      baseSha: opts?.baseSha,
      prTitle: opts?.prTitle,
      prState: opts?.prState,
      changedFiles: opts?.changedFiles,
      createdAt: now,
      updatedAt: now,
    };
    jobs.set(id, job);
    return job;
  }

  /** Look up a job by id (undefined if not found). */
  function get(id: string): JobRecord | undefined {
    return jobs.get(id);
  }

  /** All jobs (mainly for debugging / tests). */
  function list(): JobRecord[] {
    return [...jobs.values()].sort(
      (a, b) => b.createdAt - a.createdAt
    );
  }

  /**
   * Process all queued jobs up to `concurrency`. Call this on a timer or
   * immediately after enqueuing (the processor is async, so we fire it and
   * return the job id to the caller right away).
   */
  async function tick(): Promise<void> {
    if (!processor) return;
    const queued = [...jobs.values()].filter(
      (j) => j.status === 'queued' && !running.has(j.id)
    );
    const slots = concurrency - running.size;
    for (const job of queued.slice(0, slots)) {
      running.add(job.id);
      // Fire and forget — the caller gets the job id immediately, then polls.
      (async () => {
        try {
          job.status = 'running';
          job.updatedAt = Date.now();
          const result = await processor(job);
          job.status = 'done';
          job.result = result;
          job.updatedAt = Date.now();
        } catch (err: unknown) {
          job.status = 'failed';
          job.error =
            err instanceof Error ? err.message : String(err);
          job.updatedAt = Date.now();
        } finally {
          running.delete(job.id);
        }
      })();
    }
  }

  return { setProcessor, enqueue, get, list, tick };
}
