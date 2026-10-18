/**
 * extractor.ts
 *
 * Unpacks a GitHub repository .tar.gz tarball into a local directory,
 * applying the file filter so only relevant source files are written to disk.
 *
 * GitHub tarballs have a top-level directory like "owner-repo-<sha>/" that
 * wraps all files. We strip that prefix so paths become relative to the repo
 * root (e.g. "src/utils/price.ts" not "facebook-react-abc123/src/utils/price.ts").
 */

import { createReadStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import { shouldAnalyzeFile, type FileEntry } from './fileFilter.js';

// Repo-level limits to prevent abuse on the public website.
// These can be tuned via environment variables at deployment.
const MAX_REPO_TARBALL_BYTES = Number(process.env.MAX_REPO_TARBALL_BYTES ?? '100 * 1024 * 1024'); // 100 MB
const MAX_ANALYZED_FILES = Number(process.env.MAX_ANALYZED_FILES ?? '5000');

export interface ExtractResult {
  extractDir: string;         // directory containing the extracted source files
  files: FileEntry[];         // list of files that passed the filter
  totalFilesFound: number;    // total files in the tarball (before filtering)
  skippedCount: number;       // how many files were filtered out
  truncated?: boolean;        // true if file limit was hit
}

/**
 * Extracts source files from a tarball, filtering as we go.
 * Returns a list of FileEntry records for every file that passed the filter.
 */
export async function extractTarball(
  tarballPath: string,
  extractDir: string
): Promise<ExtractResult> {
  const files: FileEntry[] = [];
  let totalFilesFound = 0;
  let skippedCount = 0;
  let truncated = false;

  // Check tarball size before processing
  const stat = statSync(tarballPath);
  if (stat.size > MAX_REPO_TARBALL_BYTES) {
    throw new Error(
      `Repository tarball too large: ${stat.size} bytes (max ${MAX_REPO_TARBALL_BYTES})`
    );
  }

  // We collect entries first, then process them
  await tar.t({
    file: tarballPath,
    onentry: (entry) => {
      // Only look at regular files (skip directories and symlinks)
      if (entry.type !== 'File') return;

      totalFilesFound++;

      // Stop accepting new files once we hit the analyzed file limit
      if (files.length >= MAX_ANALYZED_FILES) {
        truncated = true;
        return;
      }

      const rawPath = entry.path;
      const sizeBytes = entry.size ?? 0;

      // Strip the top-level GitHub-generated prefix directory (e.g. "owner-repo-sha/")
      const relativePath = stripTopLevelDir(rawPath);

      if (!relativePath || !shouldAnalyzeFile(relativePath, sizeBytes)) {
        skippedCount++;
        return;
      }

      // We record it — actual extraction happens in the next pass
      files.push({
        relativePath,
        absolutePath: path.join(extractDir, relativePath),
        sizeBytes,
      });
    },
  });

  // Second pass: actually extract only the files we care about
  const allowedPaths = new Set(files.map((f) => f.relativePath));

  await tar.x({
    file: tarballPath,
    cwd: extractDir,
    filter: (rawPath) => {
      const relativePath = stripTopLevelDir(rawPath);
      return allowedPaths.has(relativePath);
    },
    strip: 1, // strip the top-level directory prefix automatically
  });

  // Update absolutePaths after extraction since tar places files relative to cwd
  for (const file of files) {
    file.absolutePath = path.join(extractDir, file.relativePath);
  }

  return { extractDir, files, totalFilesFound, skippedCount, truncated };
}

/**
 * Removes the first path segment from a tarball entry path.
 * GitHub tarballs wrap files in a top-level folder like "owner-repo-sha123/src/index.ts"
 * Strip "owner-repo-sha123/" → "src/index.ts"
 */
function stripTopLevelDir(rawPath: string): string {
  const firstSlash = rawPath.indexOf('/');
  if (firstSlash === -1) return '';
  return rawPath.slice(firstSlash + 1);
}
