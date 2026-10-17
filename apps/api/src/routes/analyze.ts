/**
 * routes/analyze.ts — Start (or fetch) an analysis job.
 *
 * POST /api/analyze
 *   Body: { owner, repo, ref? }
 *   ref may be a commit SHA or a branch name (e.g. 'main').
 *
 * Response (cache hit):   { status: 'done',  result: GraphAnalysis }
 * Response (cache miss):  { status: 'queued', jobId: string }
 * Response (error):       400 / 404 / 500 JSON
 */

import type { FastifyPluginAsync } from 'fastify';
import type { GraphAnalysis } from '@repo/analyzer';

export interface AnalyzeDeps {
  /** Enqueue a job and return its record. */
  enqueue: (owner: string, repo: string, sha: string) => { id: string; status: string };
  /** Kick off processing of queued jobs. */
  tick: () => Promise<void>;
  /** Run the analysis + cache it (mocked in tests). */
  analyzeJob: (job: { owner: string; repo: string; sha: string }) => Promise<GraphAnalysis>;
  /** Cache read for instant hits. */
  cacheGet: (owner: string, repo: string, sha: string) => Promise<GraphAnalysis | null>;
  /** GitHub helpers (injected so tests stay offline). */
  repoExists: (owner: string, repo: string) => Promise<boolean>;
  resolveRefToSha: (owner: string, repo: string, ref: string) => Promise<string | null>;
}

export interface AnalyzeBody {
  owner: string;
  repo: string;
  ref?: string; // commit SHA or branch name; defaults to 'main'
}

export const analyzeRoutes: FastifyPluginAsync<{ deps: AnalyzeDeps }> = async (
  fastify,
  opts
) => {
  const deps: AnalyzeDeps = opts.deps;

  fastify.post<{ Body: AnalyzeBody }>(
    '/analyze',
    {
      schema: {
        body: {
          type: 'object',
          required: ['owner', 'repo'],
          properties: {
            owner: { type: 'string', minLength: 1 },
            repo: { type: 'string', minLength: 1 },
            ref: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { owner, repo, ref } = request.body;
      const targetRef = ref ?? 'main';

      // ── Validate the repo exists ──────────────────────────────────────────
      if (!(await deps.repoExists(owner, repo))) {
        return reply
          .status(404)
          .send({ error: `Repository ${owner}/${repo} not found`, statusCode: 404 });
      }

      // ── Resolve ref → SHA ─────────────────────────────────────────────────
      const sha = await deps.resolveRefToSha(owner, repo, targetRef);
      if (!sha) {
        return reply
          .status(404)
          .send({ error: `Ref ${targetRef} not found in ${owner}/${repo}`, statusCode: 404 });
      }

      // ── Cache hit → return immediately ────────────────────────────────────
      const cached = await deps.cacheGet(owner, repo, sha);
      if (cached) {
        return reply.send({ status: 'done', result: cached });
      }

      // ── Cache miss → enqueue a job ────────────────────────────────────────
      const job = deps.enqueue(owner, repo, sha);
      await deps.tick(); // starts the background processor (fire-and-forget)

      return reply.status(202).send({ status: 'queued', jobId: job.id });
    }
  );
};
