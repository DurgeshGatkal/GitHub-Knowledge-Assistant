/**
 * db.ts — SQLite connection for the graph cache (sql.js build).
 *
 * sql.js is SQLite compiled to WebAssembly — a real SQLite database stored in
 * a single file, with **no native C++ compilation**, so it installs and runs
 * identically on Windows, Linux and macOS.
 *
 * One SQLite file stores every analysed repository graph keyed by
 * (owner, repo, sha). Because a commit SHA is immutable, cached results are
 * always correct and never need invalidation.
 *
 * sql.js ships no type declarations, so we declare a small local interface and
 * treat the WASM-loaded object as `any` internally.
 */

import initSqlJs from 'sql.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SqlStatement {
  run(params?: unknown[]): any;
  get(params?: unknown[]): any;
  all(params?: unknown[]): any[];
}

export interface SqlDatabase {
  run(sql: string, params?: unknown[]): any;
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  export(): Uint8Array;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS graph_cache (
    owner      TEXT NOT NULL,
    repo       TEXT NOT NULL,
    sha        TEXT NOT NULL,
    json       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (owner, repo, sha)
  )
`;

let sqlWasm: Promise<any> | null = null;

/**
 * Locates the sql.js WASM binary.
 * sql.js is hoisted to the root node_modules in this monorepo, so resolve
 * from the repo root (two levels up from apps/api/src/cache).
 */
function wasmPath(): string {
  return path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'node_modules',
    'sql.js',
    'dist',
    'sql-wasm.wasm'
  );
}

/**
 * Opens (or creates) the SQLite cache database and ensures the schema exists.
 * `dbPath` is resolved relative to the repo root when not absolute.
 */
export async function openDb(dbPath: string): Promise<SqlDatabase> {
  if (!sqlWasm) {
    sqlWasm = initSqlJs({
      locateFile: () => wasmPath(),
    });
  }
  const SQL = await sqlWasm;

  const resolved = path.isAbsolute(dbPath)
    ? dbPath
    : path.resolve(__dirname, '..', '..', dbPath);
  mkdirSync(path.dirname(resolved), { recursive: true });

  let db: SqlDatabase;
  if (existsSync(resolved)) {
    const file = readFileSync(resolved);
    db = new SQL.Database(file) as unknown as SqlDatabase;
  } else {
    db = new SQL.Database() as unknown as SqlDatabase;
  }

  db.run(CREATE_TABLE_SQL);
  return db;
}
