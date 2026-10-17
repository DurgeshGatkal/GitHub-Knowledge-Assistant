/**
 * test/cache.test.ts — SqliteGraphCache behaviour.
 *
 * Uses a temporary SQLite file so the real persistence path is exercised
 * (write → restart → read). The WASM module initialises once per test file.
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { SqliteGraphCache } from '../src/cache/graphCache.js';
import type { GraphAnalysis } from '@repo/analyzer';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

const TMP = path.join(os.tmpdir(), `ghe-api-test-${Date.now()}`);

function freshDbPath(name: string): string {
  return path.join(TMP, `${name}.db`);
}

function makeGraph(sha: string): GraphAnalysis {
  return {
    owner: 'o',
    repo: 'r',
    sha,
    nodes: [{ id: 'src/a.ts', attributes: { filePath: 'src/a.ts', sizeBytes: 10 } }],
    edges: [],
    unresolvedImports: [],
    stats: {
      totalFiles: 1,
      totalEdges: 0,
      unresolvedCount: 0,
      externalImportsSkipped: 0,
      parseErrors: 0,
    },
  };
}

describe('SqliteGraphCache', () => {
  beforeAll(async () => {
    // sql.js WASM must initialise before any cache is constructed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  it('get returns null for a missing key', async () => {
    const cache = new SqliteGraphCache(freshDbPath('missing'));
    const got = await cache.get('o', 'r', 'abc');
    expect(got).toBeNull();
    cache.close();
  });

  it('set then get returns the same graph', async () => {
    const dbPath = freshDbPath('roundtrip');
    const cache = new SqliteGraphCache(dbPath);
    const graph = makeGraph('sha1');
    await cache.set('o', 'r', 'sha1', graph);

    const got = await cache.get('o', 'r', 'sha1');
    expect(got).toEqual(graph);
    cache.close();
  });

  it('persistence survives a new cache instance (disk write)', async () => {
    const dbPath = freshDbPath('persist');
    {
      const cache = new SqliteGraphCache(dbPath);
      await cache.set('o', 'r', 'sha2', makeGraph('sha2'));
      cache.close();
    }
    // New instance opens the same file.
    const cache2 = new SqliteGraphCache(dbPath);
    const got = await cache2.get('o', 'r', 'sha2');
    expect(got?.sha).toBe('sha2');
    cache2.close();
  });

  it('has reflects presence of a key', async () => {
    const cache = new SqliteGraphCache(freshDbPath('has'));
    expect(await cache.has('o', 'r', 'x')).toBe(false);
    await cache.set('o', 'r', 'x', makeGraph('x'));
    expect(await cache.has('o', 'r', 'x')).toBe(true);
    cache.close();
  });

  it('different shas are independent keys', async () => {
    const cache = new SqliteGraphCache(freshDbPath('keys'));
    await cache.set('o', 'r', 'sha-a', makeGraph('sha-a'));
    expect(await cache.get('o', 'r', 'sha-b')).toBeNull();
    expect(await cache.has('o', 'r', 'sha-a')).toBe(true);
    cache.close();
  });
});
