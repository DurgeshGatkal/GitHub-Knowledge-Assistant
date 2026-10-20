/**
 * test/routes.test.ts — /api/analyze endpoint behaviour.
 *
 * Registers the analyze route plugin on a bare Fastify instance with fully
 * mock dependencies, so no real GitHub call or background job is needed.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { analyzeRoutes } from '../src/routes/analyze.js';
import type { GraphAnalysis, ImpactAnalysis, PRChangedFile } from '@repo/analyzer';
import type { AnalyzeDeps } from '../src/routes/analyze.js';

const VALID_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function makeGraph(sha: string): GraphAnalysis {
  return {
    owner: 'o',
    repo: 'r',
    sha,
    nodes: [],
    edges: [],
    unresolvedImports: [],
    stats: {
      totalFiles: 0,
      totalEdges: 0,
      unresolvedCount: 0,
      externalImportsSkipped: 0,
      parseErrors: 0,
    },
  };
}

function buildApp(deps: AnalyzeDeps) {
  const app = Fastify({ logger: false });
  void app.register(analyzeRoutes, { prefix: '/api', deps });
  return app;
}

describe('POST /api/analyze', () => {
  it('returns 400 when url is missing', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      cacheGet: async () => null,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 400 for an invalid GitHub URL', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      cacheGet: async () => null,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://gitlab.com/owner/repo' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNSUPPORTED_HOST');
    await app.close();
  });

  it('returns the cached graph immediately on a cache hit', async () => {
    const graph = makeGraph(VALID_SHA);
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      cacheGet: async () => graph,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: `https://github.com/o/r/commit/${VALID_SHA}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; result: GraphAnalysis; cached: boolean };
    expect(body.status).toBe('done');
    expect(body.cached).toBe(true);
    expect(body.result.sha).toBe(VALID_SHA);
    await app.close();
  });

  it('queues a job on a cache miss and returns 202', async () => {
    let enqueued: { owner: string; repo: string; sha: string } | null = null;
    let ticked = false;
    const app = buildApp({
      enqueue: (owner, repo, sha) => {
        enqueued = { owner, repo, sha };
        return { id: 'job-123', status: 'queued' };
      },
      tick: async () => {
        ticked = true;
      },
      analyzeJob: async () => makeGraph(VALID_SHA),
      cacheGet: async () => null,
      resolveRef: async () => ({ sha: VALID_SHA, ref: 'main', fromSha: false }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/o/r' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; jobId: string; cached: boolean };
    expect(body.status).toBe('queued');
    expect(body.cached).toBe(false);
    expect(body.jobId).toBe('job-123');
    expect(enqueued).toEqual({ owner: 'o', repo: 'r', sha: VALID_SHA });
    expect(ticked).toBe(true);
    await app.close();
  });

  it('resolves a commit SHA from URL without calling resolveRef', async () => {
    let resolveCalled = false;
    const app = buildApp({
      enqueue: (owner, repo, sha) => ({ id: 'j', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(sha),
      cacheGet: async () => null,
      resolveRef: async () => {
        resolveCalled = true;
        return { sha: 'resolved', ref: 'resolved', fromSha: false };
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: `https://github.com/o/r/commit/${VALID_SHA}` },
    });
    expect(res.statusCode).toBe(202);
    expect(resolveCalled).toBe(false); // full SHA → no network call
    await app.close();
  });

  it('returns 404 when ref resolver fails', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      cacheGet: async () => null,
      resolveRef: async () => ({
        code: 'REPO_NOT_FOUND',
        message: 'Repository not found or private.',
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/nope/repo' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 429 when GitHub is rate limited', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      cacheGet: async () => null,
      resolveRef: async () => ({
        code: 'GITHUB_RATE_LIMITED',
        message: 'GitHub API rate limit exceeded.',
      }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/o/r' },
    });
    expect(res.statusCode).toBe(429);
    await app.close();
  });

  it('returns cached impact analysis for a PR URL', async () => {
    const impactResult = {
      number: 42,
      title: 'Fix bug',
      state: 'open',
      headSha: VALID_SHA,
      baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      changedFiles: [
        {
          filename: 'src/foo.ts',
          previous_filename: undefined,
          status: 'modified',
          additions: 10,
          deletions: 5,
          changes: 15,
        },
      ],
      impact: {
        changedFiles: ['src/foo.ts'],
        affectedFiles: [],
        testMatches: [],
        unresolvedLinks: [],
        stats: {
          depthLimit: 3,
          visitedCount: 0,
          confirmedCount: 0,
          inferredCount: 0,
          unverifiedCount: 0,
          beyondDepthCount: 0,
          unresolvedLinkCount: 0,
        },
      },
    };
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      analyzePRJob: async () => impactResult,
      analyzeImpact: () => impactResult.impact,
      cacheGet: async () => impactResult,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
      fetchPRMetadata: async () => ({
        number: 42,
        title: 'Fix bug',
        state: 'open',
        head_sha: VALID_SHA,
        base_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        head_repo_full_name: 'o/r',
        base_repo_full_name: 'o/r',
        head_repo_is_fork: false,
      }),
      fetchPRChangedFiles: async () => [
        {
          filename: 'src/foo.ts',
          previous_filename: undefined,
          status: 'modified',
          additions: 10,
          deletions: 5,
          changes: 15,
        },
      ],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/o/r/pull/42' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; result: any; cached: boolean };
    expect(body.status).toBe('done');
    expect(body.cached).toBe(true);
    expect(body.result.number).toBe(42);
    expect(body.result.headSha).toBe(VALID_SHA);
    await app.close();
  });

  it('queues a PR job on a cache miss and returns 202', async () => {
    let enqueued: { owner: string; repo: string; sha: string; kind: string } | null = null;
    let ticked = false;
    const app = buildApp({
      enqueue: (owner, repo, sha, opts) => {
        enqueued = { owner, repo, sha, kind: opts?.kind ?? 'repo' };
        return { id: 'job-pr-123', status: 'queued' };
      },
      tick: async () => {
        ticked = true;
      },
      analyzeJob: async () => makeGraph(VALID_SHA),
      analyzePRJob: async () => ({
        number: 42,
        title: 'Fix bug',
        state: 'open',
        headSha: VALID_SHA,
        baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        changedFiles: [],
        impact: {
          changedFiles: [],
          affectedFiles: [],
          testMatches: [],
          unresolvedLinks: [],
          stats: {
            depthLimit: 3,
            visitedCount: 0,
            confirmedCount: 0,
            inferredCount: 0,
            unverifiedCount: 0,
            beyondDepthCount: 0,
            unresolvedLinkCount: 0,
          },
        },
      }),
      cacheGet: async () => null,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
      fetchPRMetadata: async () => ({
        number: 42,
        title: 'Fix bug',
        state: 'open',
        head_sha: VALID_SHA,
        base_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        head_repo_full_name: 'o/r',
        base_repo_full_name: 'o/r',
        head_repo_is_fork: false,
      }),
      fetchPRChangedFiles: async () => [],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/o/r/pull/42' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; jobId: string; cached: boolean };
    expect(body.status).toBe('queued');
    expect(body.cached).toBe(false);
    expect(body.jobId).toBe('job-pr-123');
    expect(enqueued).toEqual({
      owner: 'o',
      repo: 'r',
      sha: VALID_SHA,
      kind: 'pr',
    });
    expect(ticked).toBe(true);
    await app.close();
  });

  it('returns 404 when PR metadata fetch fails', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      analyzePRJob: async () => ({
        number: 42,
        title: 'Fix bug',
        state: 'open',
        headSha: VALID_SHA,
        baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        changedFiles: [],
        impact: {
          changedFiles: [],
          affectedFiles: [],
          testMatches: [],
          unresolvedLinks: [],
          stats: {
            depthLimit: 3,
            visitedCount: 0,
            confirmedCount: 0,
            inferredCount: 0,
            unverifiedCount: 0,
            beyondDepthCount: 0,
            unresolvedLinkCount: 0,
          },
        },
      }),
      cacheGet: async () => null,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
      fetchPRMetadata: async () => ({
        code: 'REPO_NOT_FOUND',
        message: 'Pull request not found.',
      }),
      fetchPRChangedFiles: async () => [],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/nope/repo/pull/1' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 429 when PR metadata fetch is rate limited', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(VALID_SHA),
      analyzePRJob: async () => ({
        number: 42,
        title: 'Fix bug',
        state: 'open',
        headSha: VALID_SHA,
        baseSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        changedFiles: [],
        impact: {
          changedFiles: [],
          affectedFiles: [],
          testMatches: [],
          unresolvedLinks: [],
          stats: {
            depthLimit: 3,
            visitedCount: 0,
            confirmedCount: 0,
            inferredCount: 0,
            unverifiedCount: 0,
            beyondDepthCount: 0,
            unresolvedLinkCount: 0,
          },
        },
      }),
      cacheGet: async () => null,
      resolveRef: async () => ({ sha: VALID_SHA, ref: VALID_SHA, fromSha: true }),
      fetchPRMetadata: async () => ({
        code: 'GITHUB_RATE_LIMITED',
        message: 'GitHub API rate limit exceeded.',
      }),
      fetchPRChangedFiles: async () => [],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyze',
      body: { url: 'https://github.com/o/r/pull/1' },
    });
    expect(res.statusCode).toBe(429);
    await app.close();
  });
});
