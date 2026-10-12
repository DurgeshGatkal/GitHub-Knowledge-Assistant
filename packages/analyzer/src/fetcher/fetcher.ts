/**
 * fetcher.ts
 *
 * Downloads a GitHub repository as a tarball at a specific commit SHA.
 * Uses the GitHub REST API tarball endpoint — one call replaces hundreds
 * of per-file API calls, and the SHA guarantees we always get the exact
 * version we asked for (never "latest" which could change).
 *
 * The repository code is NEVER executed — only read.
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';

export interface FetchOptions {
  owner: string;      // GitHub repo owner, e.g. "facebook"
  repo: string;       // GitHub repo name, e.g. "react"
  sha: string;        //  exact commit SHA to download
  githubToken?: string; // optional token to raise rate limits from 60 → 5000 req/hr
}

export interface FetchResult {
  tarballPath: string;  // path to the downloaded .tar.gz file on disk
  tempDir: string;       // temp directory that holds it (caller should clean up)
}

/**
 * Downloads the repository tarball for the given commit SHA.
 * Returns the path to the .tar.gz file on disk.
 */
export async function fetchRepoTarball(options: FetchOptions): Promise<FetchResult> {
  const { owner, repo, sha, githubToken } = options;

  // GitHub tarball endpoint — returns a redirect to the actual archive
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'github-intelligence-extension/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }

  // Create a unique temp directory for this download
  const tempDir = mkdirSync(
    path.join(os.tmpdir(), `ghe-${owner}-${repo}-${sha.slice(0, 8)}`),
    { recursive: true }
  ) as unknown as string ?? path.join(os.tmpdir(), `ghe-${owner}-${repo}-${sha.slice(0, 8)}`);

  const tarballPath = path.join(tempDir, 'repo.tar.gz');

  // Fetch with redirect following; GitHub sends a 302 redirect to the actual file
  const response = await fetch(url, { headers, redirect: 'follow' });

  if (!response.ok) {
    throw new Error(
      `GitHub API error: ${response.status} ${response.statusText} for ${url}`
    );
  }

  if (!response.body) {
    throw new Error('GitHub API returned an empty response body.');
  }

  // Stream the tarball directly to disk — never load the whole archive into memory
  const fileStream = createWriteStream(tarballPath);
  await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);

  return { tarballPath, tempDir };
}
