/**
 * routes/analyze.ts — Start (or fetch) an analysis job from a GitHub URL.
 *
 * POST /api/analyze
 *   Body: { url: "https://github.com/owner/repo" }
 *   The URL can point to a repo, a branch/tag, a commit SHA, or a pull request.
 *
 * Response (cache hit):   { status: 'done',  result: GraphAnalysis, cached: true }
 * Response (cache miss):  { status: 'queued', jobId: string, cached: false }
 * Response (error):       400 / 404 / 429 / 500 JSON with { error: { code, message } }
 */

import type { FastifyPluginAsync } from 'fastify';
import type { GraphAnalysis } from '@repo/analyzer';
import {
  parseGithubUrl,
  type ParsedRepoUrl,
  type ParsedCommitUrl,
  type ParsedPullUrl,
  type UrlError,
} from '@repo/analyzer';

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
  resolveRef: (
    owner: string,
    repo: string,
    ref: string | undefined,
    deps: { fetch: typeof fetch; githubToken?: string }
  ) => Promise<{ sha: string; ref: string; fromSha: boolean } | { code: string; message: string }>;
  /** GitHub token for API calls. */
  githubToken?: string;
}

export interface AnalyzeBody {
  url: string;
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
          required: ['url'],
          properties: {
            url: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { url } = request.body;

      // ── Step 1: Parse the user-pasted URL ─────────────────────────────────
      const parsed = parseGithubUrl(url);
      if ('code' in parsed) {
        return reply.status(400).send({
          error: { code: parsed.code, message: parsed.message },
        });
      }

      // ── Step 2: Resolve ref → SHA ─────────────────────────────────────────
      let sha: string;
      let resolvedRef: string;

      if (parsed.kind === 'commit') {
        sha = parsed.sha;
        resolvedRef = parsed.sha;
      } else if (parsed.kind === 'repo') {
        const resolved = await deps.resolveRef(
          parsed.owner,
          parsed.repo,
          parsed.ref,
          { fetch, githubToken: deps.githubToken }
        );
        if ('code' in resolved) {
          let statusCode = 404;
          if (resolved.code === 'GITHUB_RATE_LIMITED') statusCode = 429;
          return reply.status(statusCode).send({
            error: { code: resolved.code, message: resolved.message },
          });
        }
        sha = resolved.sha;
        resolvedRef = resolved.ref;
      } else {
        // Pull request — PR flow is handled separately (Day 11).
        // For now, reject with a clear message.
        return reply.status(400).send({
          error: {
            code: 'UNSUPPORTED_PAGE',
            message: 'Pull request URLs are not yet supported. Use a repository URL.',
          },
        });
      }

      // ── Step 3: Cache hit → return immediately ────────────────────────────
      const cached = await deps.cacheGet(parsed.owner, parsed.repo, sha);
      if (cached) {
        return reply.send({ status: 'done', result: cached, cached: true });
      }

      // ── Step 4: Cache miss → enqueue a job ────────────────────────────────
      const job = deps.enqueue(parsed.owner, parsed.repo, sha);
      await deps.tick(); // starts the background processor (fire-and-forget)

      return reply.status(202).send({
        status: 'queued',
        jobId: job.id,
        cached: false,
      });
    }
  );
};
