/**
 * resolver.ts
 *
 * Resolves raw import specifiers (e.g. './price', '@/utils/helpers') to
 * actual file paths on disk using the TypeScript Compiler API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY use TypeScript's own resolveModuleName?
 * ─────────────────────────────────────────────────────────────────────────────
 * Import resolution is deceptively hard. Five rules interact:
 *
 *   1. Relative paths   './price'   → price.ts / price/index.ts
 *   2. Path aliases     '@/utils'   → src/utils (read from tsconfig "paths")
 *   3. Index / barrel   './utils'   → utils/index.ts if utils.ts doesn't exist
 *   4. .js → .ts map   './foo.js'  → foo.ts  (Node16 ESM convention)
 *   5. baseUrl          'utils'     → <baseUrl>/utils.ts
 *
 * Writing all five rules from scratch is fragile and diverges from what the
 * actual compiler does. TypeScript's resolveModuleName already implements them
 * all correctly. We just need to give it a host that reads from the repo on disk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Critical rule from the project plan (Section 8, Days 4–6):
 * "Unresolvable paths (dynamic require(variable)) are recorded explicitly as
 *  Unverified, not silently dropped."
 * ─────────────────────────────────────────────────────────────────────────────
 */

import ts from 'typescript';
import path from 'node:path';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import type { ImportRecord } from '../parser/parser.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * How an import specifier was resolved. Matches the edge attribute
 * `resolutionMethod` defined in the project plan (Section 6 / Step 6).
 */
export type ResolutionMethod =
  | 'relative'      // './foo' → foo.ts
  | 'alias'         // '@/utils' → src/utils.ts via tsconfig paths
  | 'index'         // './utils' → utils/index.ts (barrel file)
  | 'baseUrl'       // 'utils' → <baseUrl>/utils.ts
  | 'nodeModule'    // 'react' — external package, outside the repo
  | 'unresolved';   // Could not be resolved — kept as Unverified per plan

export interface ResolvedImport {
  /** The original ImportRecord from the parser */
  original: ImportRecord;

  /**
   * Absolute path to the resolved file on disk.
   * null when isExternal=true or resolutionMethod='unresolved'.
   */
  resolvedAbsPath: string | null;

  /**
   * Path relative to the repo root (e.g. 'src/utils/price.ts').
   * null when isExternal=true or unresolved.
   */
  resolvedRelPath: string | null;

  /** How the specifier was resolved */
  resolutionMethod: ResolutionMethod;

  /**
   * True for specifiers that resolve to node_modules (e.g. 'react', 'lodash').
   * External imports are excluded from the graph — we only map intra-repo deps.
   */
  isExternal: boolean;
}

// ---------------------------------------------------------------------------
// Compiler options loading
// ---------------------------------------------------------------------------

/**
 * Reads tsconfig.json from the repo root and returns parsed CompilerOptions.
 * If no tsconfig.json exists, returns sensible defaults (Node16 resolution).
 * This is the function that unlocks path aliases and baseUrl.
 */
export function loadCompilerOptions(repoRoot: string): ts.CompilerOptions {
  const tsconfigPath = path.join(repoRoot, 'tsconfig.json');

  if (!existsSync(tsconfigPath)) {
    // Fallback: use Node16 resolution without any special paths
    return {
      moduleResolution: ts.ModuleResolutionKind.Node16,
      target: ts.ScriptTarget.ES2022,
    };
  }

  const configFile = ts.readConfigFile(tsconfigPath, (p) =>
    readFileSync(p, 'utf8')
  );

  if (configFile.error) {
    // Malformed tsconfig — fall back to defaults rather than crashing
    console.warn(
      `[resolver] Warning: could not parse tsconfig.json at ${tsconfigPath}. Using defaults.`
    );
    return {
      moduleResolution: ts.ModuleResolutionKind.Node16,
      target: ts.ScriptTarget.ES2022,
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    repoRoot
  );

  return parsed.options;
}

// ---------------------------------------------------------------------------
// Compiler host
// ---------------------------------------------------------------------------

/**
 * Creates a minimal ModuleResolutionHost that reads files from the repo
 * directory on disk. TypeScript's resolver calls these methods internally
 * when it needs to check if files or directories exist.
 *
 * We do NOT use ts.sys directly because ts.sys reads the real process CWD,
 * not the repo's directory. By providing a custom host, we ensure all file
 * existence checks happen relative to the extracted repo root.
 */
function makeHost(repoRoot: string): ts.ModuleResolutionHost {
  return {
    fileExists(fileName: string): boolean {
      return existsSync(fileName);
    },
    readFile(fileName: string): string | undefined {
      try {
        return readFileSync(fileName, 'utf8');
      } catch {
        return undefined;
      }
    },
    directoryExists(dirName: string): boolean {
      try {
        return statSync(dirName).isDirectory();
      } catch {
        return false;
      }
    },
    realpath(p: string): string {
      return p;
    },
    getCurrentDirectory(): string {
      return repoRoot;
    },
    getDirectories(p: string): string[] {
      try {
        return readdirSync(p, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        return [];
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Resolution method classifier
// ---------------------------------------------------------------------------

/**
 * Determines HOW an import was resolved, so we can store the resolutionMethod
 * edge attribute specified in the plan.
 *
 * We examine the specifier text rather than re-running the resolver:
 *   - Starts with './' or '../'  → relative
 *   - Starts with '@' or matches a tsconfig path key → alias
 *   - In node_modules           → nodeModule (already flagged isExternal)
 *   - Resolved to .../index.ts  but specifier didn't end with 'index' → index (barrel)
 */
function classifyResolution(
  specifier: string,
  resolvedPath: string,
  compilerOptions: ts.CompilerOptions,
  isExternal: boolean
): ResolutionMethod {
  if (isExternal) return 'nodeModule';
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    // Even relative paths can resolve to barrel files
    if (
      resolvedPath.endsWith('index.ts') ||
      resolvedPath.endsWith('index.tsx') ||
      resolvedPath.endsWith('index.js')
    ) {
      const specBaseName = path.basename(specifier.replace(/\.js$/, ''));
      if (specBaseName !== 'index') return 'index';
    }
    return 'relative';
  }

  // Check against tsconfig path aliases
  const pathsKeys = Object.keys(compilerOptions.paths ?? {});
  for (const key of pathsKeys) {
    const prefix = key.replace('/*', '');
    if (specifier.startsWith(prefix)) return 'alias';
  }

  // Check baseUrl resolution (bare specifier that resolved to a file)
  if (
    compilerOptions.baseUrl &&
    !specifier.startsWith('.') &&
    !specifier.startsWith('@')
  ) {
    return 'baseUrl';
  }

  return 'relative'; // default for anything else that resolved
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolveFileImportsOptions {
  /** Absolute path of the SOURCE file that contains the imports */
  sourceAbsPath: string;
  /** Absolute path of the repo root (where tsconfig.json lives) */
  repoRoot: string;
  /** The raw import records from the Tree-sitter parser */
  imports: ImportRecord[];
  /** Pre-loaded compiler options (load once per repo via loadCompilerOptions) */
  compilerOptions: ts.CompilerOptions;
}

/**
 * Resolves every import in a single source file to its real path on disk.
 *
 * Returns one ResolvedImport per import record. Unresolvable imports
 * (dynamic variable paths, missing files) are returned with
 * resolutionMethod='unresolved' — NOT silently dropped.
 *
 * Per project plan: "Unresolvable paths … are recorded explicitly as
 * Unverified, not silently dropped."
 */
/**
 * Returns true for bare npm package specifiers like 'react', 'lodash', '@scope/pkg'.
 * These are always external — they live in node_modules, not in the repo.
 *
 * WHY handle this before calling resolveModuleName?
 *   In real repos, resolveModuleName finds them in node_modules and marks them
 *   isExternalLibraryImport=true. But in fixture repos (no node_modules), the
 *   resolver returns null — we'd incorrectly label them as 'unresolved'.
 *
 * We use the actual npm package name format to avoid false positives:
 *   - Unscoped: starts with a lowercase letter, digits, or hyphens
 *   - Scoped:   starts with '@' followed by scope/package
 *   - NOT: strings starting with '_', '__', uppercase, or special chars
 *     (those are invented/dynamic specifiers that should be 'unresolved')
 */

/** Matches valid unscoped npm package names: react, lodash, my-pkg, @scope/pkg */
const NPM_PACKAGE_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(\/.*)?$/;

function isBarePackageSpecifier(
  specifier: string,
  compilerOptions: ts.CompilerOptions
): boolean {
  // Relative or absolute path — definitely not an external package
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false;

  // Check if it matches a tsconfig paths alias (e.g. '@/*' → src/*)
  // Aliases take priority over bare package detection
  const pathsKeys = Object.keys(compilerOptions.paths ?? {});
  for (const key of pathsKeys) {
    const prefix = key.replace('/*', '').replace('*', '');
    if (specifier.startsWith(prefix)) return false;
  }

  // Must look like a real npm package name
  // This rejects invented strings like '__DOES_NOT_EXIST__' (they're 'unresolved')
  return NPM_PACKAGE_RE.test(specifier);
}

export function resolveFileImports(
  options: ResolveFileImportsOptions
): ResolvedImport[] {
  const { sourceAbsPath, repoRoot, imports, compilerOptions } = options;
  const host = makeHost(repoRoot);
  const results: ResolvedImport[] = [];

  for (const imp of imports) {
    const specifier = imp.specifier;

    // ── Pre-classify bare package specifiers as external ──────────────────
    // e.g. 'react', 'lodash', '@types/node'. In real repos the TS resolver
    // would find them in node_modules. In fixture repos (no node_modules)
    // the resolver returns null — but the import is still external, not unresolved.
    if (isBarePackageSpecifier(specifier, compilerOptions)) {
      results.push({
        original: imp,
        resolvedAbsPath: null,
        resolvedRelPath: null,
        resolutionMethod: 'nodeModule',
        isExternal: true,
      });
      continue;
    }

    // Run TypeScript's own module resolver for everything else
    const result = ts.resolveModuleName(
      specifier,
      sourceAbsPath,
      compilerOptions,
      host
    );

    const resolved = result.resolvedModule;

    if (!resolved) {
      // Unresolvable — record explicitly as unresolved per plan rules
      results.push({
        original: imp,
        resolvedAbsPath: null,
        resolvedRelPath: null,
        resolutionMethod: 'unresolved',
        isExternal: false,
      });
      continue;
    }

    // The TS resolver found the file — check if it's in node_modules
    const isExternal = resolved.isExternalLibraryImport === true;
    const absPath = resolved.resolvedFileName;

    // Make path relative to the repo root for graph storage
    const relPath = isExternal
      ? null
      : path.relative(repoRoot, absPath).replace(/\\/g, '/');

    const method = classifyResolution(
      specifier,
      absPath,
      compilerOptions,
      isExternal
    );

    results.push({
      original: imp,
      resolvedAbsPath: isExternal ? null : absPath,
      resolvedRelPath: relPath,
      resolutionMethod: method,
      isExternal,
    });
  }

  return results;
}
