/**
 * server.ts — Fastify app factory.
 *
 * Builds and configures the Fastify instance with CORS, JSON parsing, error
 * handling and all route plugins. Wires the cache, job queue and analysis
 * handlers together, then injects them into each route plugin via options.
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
import { createPRAnalysisJobHandler } from './jobs/prAnalysisJob.js';
import {
  analyzeRemote,
  analyzeImpact,
  resolveRef,
  fetchPRMetadata,
  fetchPRChangedFiles,
} from '@repo/analyzer';

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

  // Repository analysis handler
  const analyzeJob = createAnalysisJobHandler({
    analyzeRemote,
    cache,
  });

  // PR analysis handler
  const analyzePRJob = createPRAnalysisJobHandler({
    analyzeRemote,
    analyzeImpact,
  });

  // Combined processor: dispatches based on job.kind
  const processJob = async (job: any): Promise<any> => {
    if (job.kind === 'pr') {
      return analyzePRJob(job);
    }
    return analyzeJob(job);
  };

  queue.setProcessor(processJob);

  const analyzeDeps = {
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
        changedFiles?: Array<{
          filename: string;
          previous_filename?: string;
          status: string;
          additions: number;
          deletions: number;
          changes: number;
        }>;
      }
    ) => queue.enqueue(owner, repo, sha, opts),
    tick: () => queue.tick(),
    analyzeJob,
    analyzePRJob,
    cacheGet: (owner: string, repo: string, sha: string) =>
      cache.get(owner, repo, sha),
    analyzeImpact,
    resolveRef: (owner: string, repo: string, ref: string | undefined) =>
      resolveRef(owner, repo, ref, {
        fetch,
        githubToken: config.githubToken,
      }),
    fetchPRMetadata: (owner: string, repo: string, number: number) =>
      fetchPRMetadata(owner, repo, number, {
        fetch,
        githubToken: config.githubToken,
      }),
    fetchPRChangedFiles: (owner: string, repo: string, number: number) =>
      fetchPRChangedFiles(owner, repo, number, {
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
