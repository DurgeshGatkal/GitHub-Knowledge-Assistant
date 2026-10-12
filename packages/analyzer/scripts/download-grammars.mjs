/**
 * download-grammars.mjs
 * Uses Node 18+ native fetch (redirects followed automatically) to download
 * pre-built Tree-sitter WASM grammar files from the npm registry CDN.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRAMMAR_DIR = path.join(__dirname, '..', 'grammars');

fs.mkdirSync(GRAMMAR_DIR, { recursive: true });

// We use the unpkg CDN which reliably serves npm package files
// These are the pre-built WASM files from the @elm-tooling/tree-sitter-languages package
// OR from the direct release of web-tree-sitter ecosystem compatible builds
const FILES = [
  {
    // JS grammar WASM from unpkg - served from npm, reliable CDN
    url: 'https://unpkg.com/tree-sitter-wasms@0.1.12/out/tree-sitter-javascript.wasm',
    dest: path.join(GRAMMAR_DIR, 'tree-sitter-javascript.wasm'),
    name: 'JavaScript grammar',
  },
  {
    // TS grammar WASM from unpkg
    url: 'https://unpkg.com/tree-sitter-wasms@0.1.12/out/tree-sitter-typescript.wasm',
    dest: path.join(GRAMMAR_DIR, 'tree-sitter-typescript.wasm'),
    name: 'TypeScript grammar',
  },
];

console.log('\n📦 Downloading Tree-sitter WASM grammar files...\n');

for (const file of FILES) {
  if (fs.existsSync(file.dest)) {
    console.log(`  ✓ ${file.name} already present, skipping.`);
    continue;
  }

  console.log(`  ⬇ Downloading ${file.name} from ${file.url} ...`);
  const res = await fetch(file.url); // Node 18+ native fetch — follows redirects automatically
  if (!res.ok) {
    console.error(`  ❌ HTTP ${res.status} for ${file.url}`);
    process.exit(1);
  }

  const dest = fs.createWriteStream(file.dest);
  await pipeline(Readable.fromWeb(res.body), dest);
  const sizeKb = Math.round(fs.statSync(file.dest).size / 1024);
  console.log(`     ✓ Saved ${sizeKb} KB → ${path.relative(process.cwd(), file.dest)}`);
}

console.log('\n✅ All grammar files ready in packages/analyzer/grammars/\n');
