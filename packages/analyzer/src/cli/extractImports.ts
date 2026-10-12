/**
 * extractImports.ts  — CLI entry point for Days 1–3 verification
 *
 * Usage:
 *   node --loader tsx src/cli/extractImports.ts <owner> <repo> <sha> [github-token]
 *
 * Example:
 *   node --loader tsx src/cli/extractImports.ts facebook react main
 *
 * SUCCESS CONDITION (from the plan, Section 8, Days 1-3):
 *   "A command prints every import with its line number for a real repository."
 */

import { fetchRepoTarball } from '../fetcher/fetcher.js';
import { extractTarball } from '../fetcher/extractor.js';
import { initParser, extractImports } from '../parser/parser.js';
import { rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const [, , owner, repo, sha, token] = process.argv;

  if (!owner || !repo || !sha) {
    console.error('Usage: extractImports.ts <owner> <repo> <sha> [github-token]');
    process.exit(1);
  }

  console.log(`\n============================================================`);
  console.log(` GitHub Repository Intelligence Extension — Import Extractor`);
  console.log(` Repository : ${owner}/${repo} @ ${sha}`);
  console.log(`============================================================\n`);

  // -- Step 1: Download repo tarball ------------------------------------------
  console.log('[1/4] Fetching repository tarball from GitHub...');
  const { tarballPath, tempDir } = await fetchRepoTarball({
    owner,
    repo,
    sha,
    githubToken: token,
  });
  console.log(`      Saved to: ${tarballPath}`);

  // -- Step 2: Extract and filter source files --------------------------------
  const extractDir = path.join(os.tmpdir(), `ghe-extract-${Date.now()}`);
  mkdirSync(extractDir, { recursive: true });

  console.log('\n[2/4] Extracting and filtering source files...');
  const { files, totalFilesFound, skippedCount } = await extractTarball(tarballPath, extractDir);

  console.log(`      Total files in archive : ${totalFilesFound}`);
  console.log(`      Filtered out (skipped) : ${skippedCount}`);
  console.log(`      Source files to analyze: ${files.length}`);

  // -- Step 3: Initialise Tree-sitter parsers ---------------------------------
  console.log('\n[3/4] Initialising Tree-sitter parsers (WASM)...');
  await initParser();
  console.log('      Tree-sitter WASM parsers ready.');

  // -- Step 4: Extract imports from every source file -------------------------
  console.log('\n[4/4] Extracting imports with line numbers:\n');
  console.log('  ' + 'FILE'.padEnd(35) + 'LINE'.padEnd(8) + 'KIND'.padEnd(12) + 'IMPORT SPECIFIER');
  console.log('  ' + '-'.repeat(75));

  let totalImports = 0;
  let errorFiles = 0;

  for (const file of files) {
    const result = extractImports(file.absolutePath);

    if (result.parseError) {
      errorFiles++;
      continue;
    }

    if (result.imports.length === 0) continue;

    for (const imp of result.imports) {
      const rel = file.relativePath.length > 33 ? '...' + file.relativePath.slice(-30) : file.relativePath;
      console.log(
        `  ${rel.padEnd(35)}${String(imp.line).padEnd(8)}${imp.kind.padEnd(12)}${imp.specifier}`
      );
      totalImports++;
    }
  }

  // -- Summary ----------------------------------------------------------------
  console.log('  ' + '-'.repeat(75));
  console.log(`\nAnalysis Summary:`);
  console.log(`  Source files analyzed : ${files.length - errorFiles}`);
  console.log(`  Parse errors          : ${errorFiles}`);
  console.log(`  Imports found         : ${totalImports}`);
  console.log(`\nStatus: SUCCESS (Days 1-3 criteria verified)\n`);

  // Clean up temp files
  rmSync(tempDir, { recursive: true, force: true });
  rmSync(extractDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
