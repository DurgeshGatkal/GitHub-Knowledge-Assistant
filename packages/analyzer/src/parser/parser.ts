/**
 * parser.ts
 *
 * Uses Tree-sitter (WASM build) to parse JS/TS source files into syntax trees
 * and extract every import/require/re-export statement with precise line numbers.
 *
 * WHY Tree-sitter and not regex?
 *   - Regex is fooled by imports inside comments or template strings.
 *   - Tree-sitter builds a real syntax tree (like a compiler), so extractions
 *     are always from actual code, never from comments or string contents.
 *
 * WHY the WASM build (web-tree-sitter)?
 *   - The native C++ Tree-sitter binding requires node-gyp compilation which
 *     breaks frequently on Windows. The WASM build works everywhere with no
 *     compilation step.
 */

import Parser from 'web-tree-sitter';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The import kinds we record — exactly the four kinds mentioned in the plan (Step 4)
export type ImportKind = 'static' | 'dynamic' | 'reexport' | 'require';

export interface ImportRecord {
  specifier: string;    // the raw path text, e.g. "./price" or "@/utils"
  line: number;         // 1-based line number in the source file
  kind: ImportKind;
}

// ---------------------------------------------------------------------------
// Singleton — Tree-sitter parser is expensive to initialise; create it once.
// ---------------------------------------------------------------------------

let jsParser: Parser | null = null;
let tsParser: Parser | null = null;
// Track whether WASM has been initialised — TreeSitter.init() must only be called once.
let wasmInitialised = false;

/**
 * Initialises the Tree-sitter parsers (idempotent — safe to call multiple times).
 * Must be called once before using extractImports().
 *
 * WHY the guard?
 *   web-tree-sitter's Parser.init() loads the WASM module. Calling it a second
 *   time throws because the WASM instance is already live. In tests, multiple
 *   test suites all call initParser() — the guard prevents the second call from
 *   throwing "TreeSitter.init is not a function" (which happens because the
 *   Parser export shape changes after the first successful init()).
 */
export async function initParser(): Promise<void> {
  // Fast path — already fully initialised
  if (jsParser !== null && tsParser !== null) return;

  const TreeSitter = (Parser as any).default || Parser;

  // Only call .init() once — WASM cannot be re-initialised
  if (!wasmInitialised) {
    await TreeSitter.init();
    wasmInitialised = true;
  }

  const Language = TreeSitter.Language || (Parser as any).Language;

  const jsWasm = path.join(__dirname, '..', '..', 'grammars', 'tree-sitter-javascript.wasm');
  const tsWasm = path.join(__dirname, '..', '..', 'grammars', 'tree-sitter-typescript.wasm');

  const jsLang = await Language.load(readFileSync(jsWasm));
  const js = new TreeSitter();
  js.setLanguage(jsLang);
  jsParser = js;

  const tsLang = await Language.load(readFileSync(tsWasm));
  const ts = new TreeSitter();
  ts.setLanguage(tsLang);
  tsParser = ts;
}

/**
 * Chooses the correct parser based on file extension.
 */
function getParser(filePath: string): Parser {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ts' || ext === '.tsx') {
    if (!tsParser) throw new Error('TypeScript parser not initialised. Call initParser() first.');
    return tsParser;
  }
  if (!jsParser) throw new Error('JavaScript parser not initialised. Call initParser() first.');
  return jsParser;
}

// ---------------------------------------------------------------------------
// Tree-sitter S-expression queries for each import kind
// ---------------------------------------------------------------------------

// These queries are written in Tree-sitter's query language.
// They match specific AST node shapes and capture the string values we need.

/** Matches:  import Foo from './foo'   |   import { a, b } from './bar' */
const STATIC_IMPORT_QUERY = `
  (import_statement
    source: (string (string_fragment) @specifier))
`;

/** Matches:  export * from './foo'   |   export { a } from './bar' */
const REEXPORT_QUERY = `
  (export_statement
    source: (string (string_fragment) @specifier))
`;

/** Matches:  import('./foo')   |   import("./bar") */
const DYNAMIC_IMPORT_QUERY = `
  (call_expression
    function: (import)
    arguments: (arguments (string (string_fragment) @specifier)))
`;

/** Matches:  require('./foo')   |   require("./bar") */
const REQUIRE_QUERY = `
  (call_expression
    function: (identifier) @fn (#eq? @fn "require")
    arguments: (arguments (string (string_fragment) @specifier)))
`;

/**
 * Runs a Tree-sitter query against a syntax tree and returns
 * all matching specifier strings with their line numbers.
 */
function runQuery(
  tree: Parser.Tree,
  language: Parser.Language,
  queryStr: string,
  kind: ImportKind
): ImportRecord[] {
  const query = language.query(queryStr);
  const captures = query.captures(tree.rootNode);

  const results: ImportRecord[] = [];
  for (const { name, node } of captures) {
    if (name === 'specifier') {
      results.push({
        specifier: node.text,
        line: node.startPosition.row + 1, // Tree-sitter rows are 0-based; convert to 1-based
        kind,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExtractResult {
  filePath: string;
  imports: ImportRecord[];
  /** True if the file could not be parsed (e.g. syntax error); imports will be empty */
  parseError: boolean;
}

/**
 * Extracts all imports from a single source file.
 * Handles .js, .jsx, .ts, .tsx, .mjs, .cjs
 *
 * Returns an ExtractResult — never throws, so one bad file doesn't crash the whole run.
 */
export function extractImports(filePath: string): ExtractResult {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    return { filePath, imports: [], parseError: true };
  }

  let parser: Parser;
  try {
    parser = getParser(filePath);
  } catch {
    return { filePath, imports: [], parseError: true };
  }

  const tree = parser.parse(source);
  const language = parser.getLanguage();
  const imports: ImportRecord[] = [];

  // Run all four query kinds — exactly the four types listed in the plan (Step 4)
  imports.push(...runQuery(tree, language, STATIC_IMPORT_QUERY, 'static'));
  imports.push(...runQuery(tree, language, REEXPORT_QUERY, 'reexport'));
  imports.push(...runQuery(tree, language, DYNAMIC_IMPORT_QUERY, 'dynamic'));
  imports.push(...runQuery(tree, language, REQUIRE_QUERY, 'require'));

  // Sort by line number for predictable output
  imports.sort((a, b) => a.line - b.line);

  return { filePath, imports, parseError: false };
}
