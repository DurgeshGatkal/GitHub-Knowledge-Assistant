/**
 * routes/jobs.ts — Job lifecycle / polling.
 *
 * GET /api/jobs/:id  →  { status, result?, error? }
 *
 * The extension polls this every 1–2 s until status is 'done' or 'failed'.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { JobRecord } from '../jobs/queue.js';

export interface JobsDeps {
  /** Look up a job by id. */
  get: (id: string) => JobRecord | undefined;
}

export const jobsRoutes: FastifyPluginAsync<{ deps: JobsDeps }> = async (
  fastify,
  opts
) => {
  const deps: JobsDeps = opts.deps;

  fastify.get<{ Params: { id: string } }>(
    '/jobs/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
      },
    },
    (request, reply) => {
      const job = deps.get(request.params.id);
      if (!job) {
        return reply.status(404).send({ error: 'Job not found', statusCode: 404 });
      }
      const { status, result, error } = job;
      return reply.send({ status, result, error });
    }
  );
};
