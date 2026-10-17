/**
 * routes/health.ts — Liveness endpoint.
 *
 * GET /api/health  →  { ok: true }
 */

import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async () => ({ ok: true }));
};
