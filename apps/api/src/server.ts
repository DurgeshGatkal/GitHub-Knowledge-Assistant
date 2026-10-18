/**
 * server.ts — Fastify app factory.
 *
 * Builds and configures the Fastify instance with CORS, JSON parsing, error
 * handling and all route plugins. Wires the cache, job queue and analysis
 * handler together, then injects them into each route plugin via options.
 *
 * Exported (not auto-started) so vitest can create an in-memory server via
 * `server.inject()` — no open port, no network.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Config } from './config.js';
import { healthRoutes } from './routes/health.js';
import { analyzeRoutes } from './routes/analyze.js';
import { jobsRoutes } from './routes/jobs.js';
import { graphRoutes } from './routes/graph.js';
import { SqliteGraphCache } from './cache/graphCache.js';
import { createJobQueue } from './jobs/queue.js';
import { createAnalysisJobHandler } from './jobs/analysisJob.js';
import { analyzeRemote } from '@repo/analyzer';
import { resolveRef } from '@repo/analyzer';

export function buildServer(config: Config) {
  const fastify = Fastify({
    logger: false,
    // Request body limit is enforced per-route where needed (Fastify v4 has no
    // top-level requestBodyLimit option).
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Allow the website dev server and production origin.
  void fastify.register(cors, {
    origin: (origin, cb) => {
      const allowed = [config.corsOrigin, 'http://localhost:5173', 'http://127.0.0.1:5173'];
      if (!origin || allowed.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  // Protect the public analyze endpoint from abuse.
  void fastify.register(rateLimit, {
    max: 10,
    timeWindow: 60 * 1000, // 10 requests per minute per IP
  });

  // ── Error handler ─────────────────────────────────────────────────────────
  // Always return JSON, never HTML stack traces, to clients.
  fastify.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode >= 500 ? 'Internal server error' : error.message;
    void request.log.error(error);
    return reply.status(statusCode).send({ error: message, statusCode });
  });

  // ── Not-found ─────────────────────────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ error: 'Not found', statusCode: 404 });
  });

  // ── Dependencies ──────────────────────────────────────────────────────────
  const cache = new SqliteGraphCache(config.dbPath);
  const queue = createJobQueue({ concurrency: 1 });
  const analyzeJob = createAnalysisJobHandler({
    analyzeRemote,
    cache,
  });
  queue.setProcessor(analyzeJob);

  const analyzeDeps = {
    enqueue: (owner: string, repo: string, sha: string) =>
      queue.enqueue(owner, repo, sha),
    tick: () => queue.tick(),
    analyzeJob,
    cacheGet: (owner: string, repo: string, sha: string) =>
      cache.get(owner, repo, sha),
    resolveRef: (owner: string, repo: string, ref: string | undefined) =>
      resolveRef(owner, repo, ref, {
        fetch,
        githubToken: config.githubToken,
      }),
  };
  const jobsDeps = { get: (id: string) => queue.get(id) };
  const graphDeps = {
    cacheGet: (owner: string, repo: string, sha: string) =>
      cache.get(owner, repo, sha),
  };

  // ── Routes (all under /api) ───────────────────────────────────────────────
  void fastify.register(healthRoutes, { prefix: '/api' });
  void fastify.register(analyzeRoutes, { prefix: '/api', deps: analyzeDeps });
  void fastify.register(jobsRoutes, { prefix: '/api', deps: jobsDeps });
  void fastify.register(graphRoutes, { prefix: '/api', deps: graphDeps });

  return fastify;
}
