/**
 * fileFilter.ts
 *
 * Decides which files from the repository tarball should be analyzed.
 *
 * Keep:  .js  .jsx  .ts  .tsx  .mjs  .cjs
 * Skip:  node_modules, dist, build output, minified files,
 *        lockfiles, binaries, and very large files.
 *
 * This follows the exact filter rules from Section 6 / Step 3 of the plan.
 */

// Maximum file size we are willing to parse (2 MB — large files are usually generated)
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

// Source file extensions we care about (exactly as specified in the plan)
const ALLOWED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

// Directory names that should always be skipped
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '__pycache__',
  '.git',
]);

// File name patterns that are never source code  
const SKIPPED_FILE_PATTERNS: RegExp[] = [
  /\.min\.[cm]?js$/,          // minified JS  e.g. bundle.min.js
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.d\.ts$/,                 // TypeScript declaration files (generated)
  /\.map$/,                   // source maps (generated)
];

export interface FileEntry {
  relativePath: string;       // path inside the repo, e.g. "src/utils/price.ts"
  absolutePath: string;       // full path on disk in the temp directory
  sizeBytes: number;
}

/**
 * Returns true if the file at the given path should be analyzed.
 * @param relativePath - the path as it appears inside the repo tarball
 * @param sizeBytes    - file size reported by the tar entry
 */
export function shouldAnalyzeFile(relativePath: string, sizeBytes: number): boolean {
  // 1. Size limit — skip very large files (usually auto-generated)
  if (sizeBytes > MAX_FILE_SIZE_BYTES) return false;

  // 2. Split the path into parts to inspect every directory segment
  const parts = relativePath.split('/');
  const filename = parts[parts.length - 1] ?? '';

  // 3. Skip files inside excluded directories (any segment of the path)
  for (const part of parts.slice(0, -1)) {
    if (SKIPPED_DIRS.has(part)) return false;
  }

  // 4. Skip well-known non-source file patterns
  for (const pattern of SKIPPED_FILE_PATTERNS) {
    if (pattern.test(filename)) return false;
  }

  // 5. Only keep files with the exact allowed extensions
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return false;
  const ext = filename.slice(lastDot);  // e.g. ".ts"
  return ALLOWED_EXTENSIONS.has(ext);
}
