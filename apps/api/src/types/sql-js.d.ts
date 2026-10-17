/**
 * sql-js.d.ts — Minimal type declarations for sql.js (no bundled types).
 *
 * Declares initSqlJs which the cache uses to initialise the WASM module.
 */

declare module 'sql.js' {
  function initSqlJs(opts?: {
    locateFile?: (filename: string) => string;
  }): Promise<any>;

  export default initSqlJs;
}
