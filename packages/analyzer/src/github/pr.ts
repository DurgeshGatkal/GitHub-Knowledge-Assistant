/**
 * pr.ts — Pull Request metadata and changed files fetching.
 *
 * Fetches PR metadata and the list of changed files from the GitHub API,
 * with pagination support for PRs with many files.
 */

import type { RefResolverDeps } from './resolveRef.js';

const GITHUB_API = 'https://api.github.com';

export type PRFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface PRChangedFile {
  /** File path in the PR */
  filename: string;
  /** Previous filename (for renames) */
  previous_filename?: string;
  /** Change status */
  status: PRFileStatus;
  /** Number of additions */
  additions: number;
  /** Number of deletions */
  deletions: number;
  /** Number of changes */
  changes: number;
}

export interface PRMetadata {
  /** PR number */
  number: number;
  /** PR title */
  title: string;
  /** PR state (open, closed, merged) */
  state: string;
  /** Head commit SHA */
  head_sha: string;
  /** Base commit SHA */
  base_sha: string;
  /** Head repo full name (for fork detection) */
  head_repo_full_name: string;
  /** Base repo full name */
  base_repo_full_name: string;
  /** Whether the head repo is a fork */
  head_repo_is_fork: boolean;
}

export interface PRFetchDeps extends RefResolverDeps {}

function githubHeaders(githubToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-intelligence-extension/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }
  return headers;
}

/**
 * Fetch PR metadata from GitHub.
 */
export async function fetchPRMetadata(
  owner: string,
  repo: string,
  number: number,
  deps: PRFetchDeps
): Promise<PRMetadata | { code: string; message: string }> {
  const { fetch: fetchFn, githubToken } = deps;
  const headers = githubHeaders(githubToken);

  try {
    const res = await fetchFn(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/pulls/${number}`,
      { headers }
    );

    if (res.status === 404) {
      return { code: 'REPO_NOT_FOUND', message: 'Pull request not found.' };
    }
    if (res.status === 403) {
      return { code: 'GITHUB_RATE_LIMITED', message: 'GitHub API rate limit exceeded.' };
    }
    if (!res.ok) {
      return { code: 'NETWORK_ERROR', message: `GitHub API error ${res.status}` };
    }

    const data = (await res.json()) as {
      number: number;
      title: string;
      state: string;
      head: { sha: string; repo: { full_name: string; fork: boolean } };
      base: { sha: string; repo: { full_name: string } };
    };

    return {
      number: data.number,
      title: data.title,
      state: data.state,
      head_sha: data.head.sha,
      base_sha: data.base.sha,
      head_repo_full_name: data.head.repo.full_name,
      base_repo_full_name: data.base.repo.full_name,
      head_repo_is_fork: data.head.repo.fork,
    };
  } catch {
    return { code: 'NETWORK_ERROR', message: 'Failed to reach GitHub API.' };
  }
}

/**
 * Fetch all changed files from a PR, with pagination.
 * GitHub returns max 100 files per page and caps at 3000 files total.
 */
export async function fetchPRChangedFiles(
  owner: string,
  repo: string,
  number: number,
  deps: PRFetchDeps
): Promise<PRChangedFile[] | { code: string; message: string }> {
  const { fetch: fetchFn, githubToken } = deps;
  const headers = githubHeaders(githubToken);
  const files: PRChangedFile[] = [];
  let page = 1;
  const perPage = 100;
  const MAX_FILES = 3000;

  while (files.length < MAX_FILES) {
    try {
      const res = await fetchFn(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/pulls/${number}/files?per_page=${perPage}&page=${page}`,
        { headers }
      );

      if (res.status === 404) {
        return { code: 'REPO_NOT_FOUND', message: 'Pull request not found.' };
      }
      if (res.status === 403) {
        return { code: 'GITHUB_RATE_LIMITED', message: 'GitHub API rate limit exceeded.' };
      }
      if (!res.ok) {
        return { code: 'NETWORK_ERROR', message: `GitHub API error ${res.status}` };
      }

      const pageData = (await res.json()) as Array<{
        filename: string;
        previous_filename?: string;
        status: string;
        additions: number;
        deletions: number;
        changes: number;
      }>;

      if (!pageData || pageData.length === 0) {
        break;
      }

      for (const item of pageData) {
        if (files.length >= MAX_FILES) {
          break;
        }
        files.push({
          filename: item.filename,
          previous_filename: item.previous_filename,
          status: item.status as PRFileStatus,
          additions: item.additions,
          deletions: item.deletions,
          changes: item.changes,
        });
      }

      // If we got fewer than perPage, we're on the last page
      if (pageData.length < perPage) {
        break;
      }

      page++;
    } catch {
      return { code: 'NETWORK_ERROR', message: 'Failed to reach GitHub API.' };
    }
  }

  if (files.length >= MAX_FILES) {
    return {
      code: 'PR_TOO_LARGE',
      message: `PR has more than ${MAX_FILES} changed files. Analysis may be incomplete.`,
    };
  }

  return files;
}
