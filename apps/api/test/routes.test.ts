/**
 * test/routes.test.ts — /api/analyze endpoint behaviour.
 *
 * Registers the analyze route plugin on a bare Fastify instance with fully
 * mock dependencies, so no real GitHub call or background job is needed.
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { analyzeRoutes } from '../src/routes/analyze.js';
import type { GraphAnalysis } from '@repo/analyzer';
import type { AnalyzeDeps } from '../src/routes/analyze.js';

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
  void app.register(analyzeRoutes, { deps });
  return app;
}

describe('POST /api/analyze', () => {
  it('returns 400 when owner or repo is missing', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph('x'),
      cacheGet: async () => null,
      repoExists: async () => true,
      resolveRefToSha: async () => 'abc',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/analyze',
      body: { owner: '', repo: 'r' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 404 when the repo does not exist', async () => {
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph('x'),
      cacheGet: async () => null,
      repoExists: async () => false,
      resolveRefToSha: async () => null,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/analyze',
      body: { owner: 'nope', repo: 'repo' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns the cached graph immediately on a cache hit', async () => {
    const graph = makeGraph('cached-sha');
    const app = buildApp({
      enqueue: () => ({ id: 'j1', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph('x'),
      cacheGet: async () => graph,
      repoExists: async () => true,
      resolveRefToSha: async () => 'cached-sha',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/analyze',
      body: { owner: 'o', repo: 'r', ref: 'cached-sha' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; result: GraphAnalysis };
    expect(body.status).toBe('done');
    expect(body.result.sha).toBe('cached-sha');
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
      analyzeJob: async () => makeGraph('new-sha'),
      cacheGet: async () => null,
      repoExists: async () => true,
      resolveRefToSha: async () => 'new-sha',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/analyze',
      body: { owner: 'o', repo: 'r', ref: 'main' },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as { status: string; jobId: string };
    expect(body.status).toBe('queued');
    expect(body.jobId).toBe('job-123');
    expect(enqueued).toEqual({ owner: 'o', repo: 'r', sha: 'new-sha' });
    expect(ticked).toBe(true);
    await app.close();
  });

  it('resolves a 40-hex SHA ref without calling resolveRefToSha', async () => {
    let resolved: string | null = null;
    const app = buildApp({
      enqueue: (owner, repo, sha) => ({ id: 'j', status: 'queued' }),
      tick: async () => {},
      analyzeJob: async () => makeGraph(sha),
      cacheGet: async () => null,
      repoExists: async () => true,
      resolveRefToSha: async (o, r, ref) => {
        resolved = ref;
        return ref;
      },
    });
    const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = await app.inject({
      method: 'POST',
      url: '/analyze',
      body: { owner: 'o', repo: 'r', ref: sha },
    });
    expect(res.statusCode).toBe(202);
    expect(resolved).toBe(sha);
    await app.close();
  });
});
