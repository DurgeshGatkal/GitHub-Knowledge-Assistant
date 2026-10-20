/**
 * routes/analyze.ts — Start (or fetch) an analysis job from a GitHub URL.
 *
 * POST /api/analyze
 *   Body: { url: "https://github.com/owner/repo" }
 *   The URL can point to a repo, a branch/tag, a commit SHA, or a pull request.
 *
 * Response (cache hit):   { status: 'done',  result: GraphAnalysis | PRAnalysisResult, cached: true }
 * Response (cache miss):  { status: 'queued', jobId: string, cached: false }
 * Response (error):       400 / 404 / 429 / 500 JSON with { error: { code, message } }
 */

import type { FastifyPluginAsync } from 'fastify';
import type { GraphAnalysis, ImpactAnalysis, PRChangedFile } from '@repo/analyzer';
import {
  parseGithubUrl,
  type analyzeImpact,
  type ParsedRepoUrl,
  type ParsedCommitUrl,
  type ParsedPullUrl,
  type UrlError,
} from '@repo/analyzer';

export interface AnalyzeDeps {
  /** Enqueue a job and return its record. */
  enqueue: (
    owner: string,
    repo: string,
    sha: string,
    opts?: {
      kind?: 'repo' | 'pr';
      prNumber?: number;
      baseSha?: string;
      prTitle?: string;
      prState?: string;
      changedFiles?: PRChangedFile[];
    }
  ) => { id: string; status: string };
  /** Kick off processing of queued jobs. */
  tick: () => Promise<void>;
  /** Run the analysis + cache it (mocked in tests). */
  analyzeJob: (job: { owner: string; repo: string; sha: string }) => Promise<GraphAnalysis>;
  /** Run PR analysis + cache it (mocked in tests). */
  analyzePRJob: (job: {
    owner: string;
    repo: string;
    sha: string;
    prNumber: number;
    baseSha: string;
    changedFiles: PRChangedFile[];
    prTitle: string;
    prState: string;
  }) => Promise<{
    number: number;
    title: string;
    state: string;
    headSha: string;
    baseSha: string;
    changedFiles: PRChangedFile[];
    impact: ImpactAnalysis;
  }>;
  /** Cache read for instant hits. */
  cacheGet: (owner: string, repo: string, sha: string) => Promise<GraphAnalysis | null>;
  /** Impact analysis over a cached head graph (used for PR cache hits). */
  analyzeImpact: typeof analyzeImpact;
  /** GitHub helpers (injected so tests stay offline). */
  resolveRef: (
    owner: string,
    repo: string,
    ref: string | undefined,
    deps: { fetch: typeof fetch; githubToken?: string }
  ) => Promise<{ sha: string; ref: string; fromSha: boolean } | { code: string; message: string }>;
  /** Fetch PR metadata (mocked in tests). */
  fetchPRMetadata: (
    owner: string,
    repo: string,
    number: number,
    deps: { fetch: typeof fetch; githubToken?: string }
  ) => Promise<
    | {
        number: number;
        title: string;
        state: string;
        head_sha: string;
        base_sha: string;
        head_repo_full_name: string;
        base_repo_full_name: string;
        head_repo_is_fork: boolean;
      }
      | { code: string; message: string }
    >;
  /** Fetch PR changed files (mocked in tests). */
  fetchPRChangedFiles: (
    owner: string,
    repo: string,
    number: number,
    deps: { fetch: typeof fetch; githubToken?: string }
  ) => Promise<PRChangedFile[] | { code: string; message: string }>;
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

      // ── Step 2: Handle based on URL kind ──────────────────────────────────
      if (parsed.kind === 'commit') {
        // ── Commit URL: use SHA directly ────────────────────────────────────
        const sha = parsed.sha;

        // ── Cache hit → return immediately ─────────────────────────────────
        const cached = await deps.cacheGet(parsed.owner, parsed.repo, sha);
        if (cached) {
          return reply.send({ status: 'done', result: cached, cached: true });
        }

        // ── Cache miss → enqueue a job ──────────────────────────────────────
        const job = deps.enqueue(parsed.owner, parsed.repo, sha);
        await deps.tick();

        return reply.status(202).send({
          status: 'queued',
          jobId: job.id,
          cached: false,
        });
      }

      if (parsed.kind === 'repo') {
        // ── Repository URL: resolve ref → SHA ───────────────────────────────
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

        const sha = resolved.sha;

        // ── Cache hit → return immediately ─────────────────────────────────
        const cached = await deps.cacheGet(parsed.owner, parsed.repo, sha);
        if (cached) {
          return reply.send({ status: 'done', result: cached, cached: true });
        }

        // ── Cache miss → enqueue a job ──────────────────────────────────────
        const job = deps.enqueue(parsed.owner, parsed.repo, sha);
        await deps.tick();

        return reply.status(202).send({
          status: 'queued',
          jobId: job.id,
          cached: false,
        });
      }

      if (parsed.kind === 'pull') {
        // ── Pull Request URL: fetch metadata + changed files ────────────────
        const prMeta = await deps.fetchPRMetadata(
          parsed.owner,
          parsed.repo,
          parsed.number,
          { fetch, githubToken: deps.githubToken }
        );
        if ('code' in prMeta) {
          let statusCode = 404;
          if (prMeta.code === 'GITHUB_RATE_LIMITED') statusCode = 429;
          return reply.status(statusCode).send({
            error: { code: prMeta.code, message: prMeta.message },
          });
        }

        const prFiles = await deps.fetchPRChangedFiles(
          parsed.owner,
          parsed.repo,
          parsed.number,
          { fetch, githubToken: deps.githubToken }
        );
        if ('code' in prFiles) {
          let statusCode = 404;
          if (prFiles.code === 'GITHUB_RATE_LIMITED') statusCode = 429;
          if (prFiles.code === 'PR_TOO_LARGE') statusCode = 413;
          return reply.status(statusCode).send({
            error: { code: prFiles.code, message: prFiles.message },
          });
        }

        const headSha = prMeta.head_sha;
        const baseSha = prMeta.base_sha;

        // ── Cache hit → build the PR result from the cached head graph ─────
        const cached = await deps.cacheGet(parsed.owner, parsed.repo, headSha);
        if (cached) {
          const impact = deps.analyzeImpact(cached, {
            changedFiles: prFiles.map((f) => f.filename),
            depthLimit: 3,
          });
          return reply.send({
            status: 'done',
            result: {
              number: parsed.number,
              title: prMeta.title,
              state: prMeta.state,
              headSha,
              baseSha,
              changedFiles: prFiles,
              impact,
            },
            cached: true,
          });
        }

        // ── Cache miss → enqueue a PR job ───────────────────────────────────
        const job = deps.enqueue(parsed.owner, parsed.repo, headSha, {
          kind: 'pr',
          prNumber: parsed.number,
          baseSha,
          prTitle: prMeta.title,
          prState: prMeta.state,
          changedFiles: prFiles,
        });
        await deps.tick();

        return reply.status(202).send({
          status: 'queued',
          jobId: job.id,
          cached: false,
        });
      }
    }
  );
};
