/**
 * graphCache.ts — Persisted cache of analysed repository graphs.
 *
 * Interface:
 *   get(owner, repo, sha)   → GraphAnalysis | null
 *   set(owner, repo, sha, graph) → void
 *   has(owner, repo, sha)   → boolean
 *
 * Implementation: SQLite via sql.js (pure-JS, no native build).
 *
 * Why sql.js:
 *   - Real SQLite semantics stored in a single file — the plan's MVP choice
 *     ("SQLite first, Postgres or Redis later").
 *   - Zero native compilation, so it installs on Windows without Visual Studio.
 *   - SHA-keyed means a repo is never analysed twice — the plan's core
 *     caching requirement (§6 Step 2, §8 Days 9–10).
 *
 * Everything goes through this interface, so a different store can be swapped
 * in later without touching callers.
 */

import type { GraphAnalysis } from '@repo/analyzer';
import type { SqlDatabase } from './db.js';
import { openDb } from './db.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export interface GraphCache {
  get(owner: string, repo: string, sha: string): Promise<GraphAnalysis | null>;
  set(
    owner: string,
    repo: string,
    sha: string,
    graph: GraphAnalysis
  ): Promise<void>;
  has(owner: string, repo: string, sha: string): Promise<boolean>;
}

export class SqliteGraphCache implements GraphCache {
  private readonly dbPath: string;
  private readonly dbPromise: Promise<SqlDatabase>;

  constructor(dbPath: string) {
    this.dbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(dbPath);
    this.dbPromise = openDb(this.dbPath);
  }

  private async db(): Promise<SqlDatabase> {
    return this.dbPromise;
  }

  async get(
    owner: string,
    repo: string,
    sha: string
  ): Promise<GraphAnalysis | null> {
    const db = await this.db();
    const row = db
      .prepare(
        'SELECT json FROM graph_cache WHERE owner = ? AND repo = ? AND sha = ?'
      )
      .get([owner, repo, sha]) as unknown[];
    if (!row || row.length === 0) return null;
    return JSON.parse(row[0] as string) as GraphAnalysis;
  }

  async set(
    owner: string,
    repo: string,
    sha: string,
    graph: GraphAnalysis
  ): Promise<void> {
    const db = await this.db();
    db.run(
      'INSERT OR REPLACE INTO graph_cache (owner, repo, sha, json, created_at) VALUES (?, ?, ?, ?, ?)',
      [owner, repo, sha, JSON.stringify(graph), Date.now()]
    );
    // Persist to disk so the cache survives restarts.
    const data = db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  async has(owner: string, repo: string, sha: string): Promise<boolean> {
    const db = await this.db();
    const row = db
      .prepare(
        'SELECT 1 FROM graph_cache WHERE owner = ? AND repo = ? AND sha = ?'
      )
      .get([owner, repo, sha]) as unknown[];
    return Boolean(row && row.length > 0);
  }

  /** sql.js databases are garbage-collected; kept for interface symmetry. */
  close(): void {
    // No explicit close needed.
  }
}
