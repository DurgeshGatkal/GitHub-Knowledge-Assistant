/**
 * routes/graph.ts — Fetch a cached graph directly.
 *
 * GET /api/graph/:owner/:repo/:sha  →  GraphAnalysis | 404
 *
 * Used after a job completes, or by any client that already knows the SHA
 * and wants the graph without going through the job flow.
 */

import type { FastifyPluginAsync } from 'fastify';
import type { GraphAnalysis } from '@repo/analyzer';

export interface GraphDeps {
  /** Read a cached graph. */
  cacheGet: (owner: string, repo: string, sha: string) => Promise<GraphAnalysis | null>;
}

export const graphRoutes: FastifyPluginAsync<{ deps: GraphDeps }> = async (
  fastify,
  opts
) => {
  const deps: GraphDeps = opts.deps;

  fastify.get<{ Params: { owner: string; repo: string; sha: string } }>(
    '/graph/:owner/:repo/:sha',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            owner: { type: 'string' },
            repo: { type: 'string' },
            sha: { type: 'string' },
          },
          required: ['owner', 'repo', 'sha'],
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { owner, repo, sha } = request.params;
      const graph = await deps.cacheGet(owner, repo, sha);
      if (!graph) {
        return reply
          .status(404)
          .send({ error: `Graph not cached for ${owner}/${repo}@${sha}`, statusCode: 404 });
      }
      return reply.send(graph);
    }
  );
};
