/**
 * index.ts — API entry point.
 *
 * Builds the Fastify server from config and starts listening.
 * Exported so tests can spin up an in-memory server without opening a port.
 */

import { buildServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();

const server = buildServer(config);

server
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(`\n[api] listening on ${address}`);
    console.log(`[api] health:   GET  ${address}/api/health`);
    console.log(`[api] analyse:  POST ${address}/api/analyze`);
    console.log(`[api] job poll: GET  ${address}/api/jobs/:id`);
    console.log(`[api] graph:    GET  ${address}/api/graph/:owner/:repo/:sha\n`);
  })
  .catch((err: Error) => {
    // eslint-disable-next-line no-console
    console.error('[api] failed to start:', err.message);
    process.exit(1);
  });

export { server, config };
