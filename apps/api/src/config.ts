/**
 * config.ts — Runtime configuration for the API server.
 *
 * Everything is environment-driven so secrets (GitHub token) and deployment
 * details (port, DB path, CORS origin) never need to be hard-coded.
 */

export interface Config {
  /** Port the HTTP server listens on. */
  port: number;
  /** Bind address. */
  host: string;
  /** Optional GitHub personal access token (raises rate limit 60 → 5000 req/hr). */
  githubToken: string | undefined;
  /** Path to the SQLite cache file. */
  dbPath: string;
  /** Origins allowed to call the API (the extension/chrome origin in prod). */
  corsOrigin: string | string[];
  /** Max repo tarball size we will accept (MB). */
  maxRepoSizeMB: number;
  /** Max number of source files we will analyse per repo. */
  maxFiles: number;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? '8787'),
    host: process.env.HOST ?? '0.0.0.0',
    githubToken: process.env.GITHUB_TOKEN ?? undefined,
    dbPath: process.env.DB_PATH ?? './data/graphs.db',
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    maxRepoSizeMB: Number(process.env.MAX_REPO_SIZE_MB ?? '100'),
    maxFiles: Number(process.env.MAX_FILES ?? '5000'),
  };
}
