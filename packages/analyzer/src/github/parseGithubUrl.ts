/**
 * parseGithubUrl.ts — Parse and validate a GitHub URL pasted by a user.
 *
 * Pure function: no network, no browser APIs. Returns a typed result so the
 * UI can show friendly errors. Replaces the extension's "page detection"
 * (Step 1) — on a website the user provides the URL, so we must validate it.
 */

export type UrlKind = 'repo' | 'pull' | 'commit';

export interface ParsedRepoUrl {
  kind: 'repo';
  owner: string;
  repo: string;
  ref?: string;      // branch, tag, or commit SHA from the URL path
  path?: string;     // optional path inside the repo (after /tree/ or /blob/)
}

export interface ParsedPullUrl {
  kind: 'pull';
  owner: string;
  repo: string;
  number: number;
}

export interface ParsedCommitUrl {
  kind: 'commit';
  owner: string;
  repo: string;
  sha: string;
}

export type ParsedGithubUrl = ParsedRepoUrl | ParsedPullUrl | ParsedCommitUrl;

export type UrlErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_HOST'
  | 'UNSUPPORTED_PAGE'
  | 'INVALID_OWNER'
  | 'INVALID_REPO'
  | 'INVALID_REF'
  | 'INVALID_SHA';

export interface UrlError {
  code: UrlErrorCode;
  message: string;
}

export type ParseResult = ParsedGithubUrl | UrlError;

// GitHub rules: owner/repo names (alphanumeric and single hyphens, max 39 for owner)
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);

/**
 * Parse a user-pasted GitHub URL.
 *
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch
 *   https://github.com/owner/repo/blob/branch/path/to/file.ts
 *   https://github.com/owner/repo/commit/abc123...
 *   https://github.com/owner/repo/pull/42
 *   github.com/owner/repo  (no scheme -> treated as https)
 *
 * Returns a typed ParsedGithubUrl or a UrlError.
 */
export function parseGithubUrl(input: string): ParseResult {
  let raw = input.trim();

  // Normalize scheme
  if (!/^https?:\/\//i.test(raw)) {
    raw = 'https://' + raw;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { code: 'INVALID_URL', message: 'Not a valid URL.' };
  }

  // Validate scheme
  if (url.protocol !== 'https:') {
    return { code: 'UNSUPPORTED_HOST', message: 'Only https:// GitHub URLs are supported.' };
  }

  // Validate host
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    return { code: 'UNSUPPORTED_HOST', message: 'Only github.com URLs are supported.' };
  }

  // Strip trailing slash, .git, query, hash
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname.endsWith('.git')) {
    pathname = pathname.slice(0, -4);
  }
  const parts = pathname.split('/').filter((p) => p.length > 0);

  // Expected: /owner/repo or /owner/repo/...
  if (parts.length < 2) {
    return { code: 'INVALID_URL', message: 'URL must include owner and repository.' };
  }

  const owner = parts[0];
  const repo = parts[1];

  if (!OWNER_RE.test(owner)) {
    return { code: 'INVALID_OWNER', message: 'Repository owner name is invalid.' };
  }
  if (!REPO_RE.test(repo)) {
    return { code: 'INVALID_REPO', message: 'Repository name is invalid.' };
  }

  const rest = parts.slice(2);

  // /owner/repo  -> repo (default branch)
  if (rest.length === 0) {
    return { kind: 'repo', owner, repo };
  }

  // /owner/repo/tree/{ref}[/path] or /owner/repo/blob/{ref}[/path]
  if (rest[0] === 'tree' || rest[0] === 'blob') {
    if (rest.length < 2) {
      return { code: 'INVALID_URL', message: 'Missing branch name after /tree or /blob.' };
    }
    const ref = rest[1];
    const path = rest.slice(2).join('/') || undefined;
    return { kind: 'repo', owner, repo, ref, path };
  }

  // /owner/repo/commit/{sha}
  if (rest[0] === 'commit') {
    if (rest.length < 2) {
      return { code: 'INVALID_URL', message: 'Missing commit SHA after /commit.' };
    }
    const sha = rest[1];
    if (!SHA_RE.test(sha)) {
      return { code: 'INVALID_SHA', message: 'Commit SHA is invalid.' };
    }
    return { kind: 'commit', owner, repo, sha };
  }

  // /owner/repo/pull/{number}[/files|/commits|/checks]
  if (rest[0] === 'pull') {
    if (rest.length < 2) {
      return { code: 'INVALID_URL', message: 'Missing PR number after /pull.' };
    }
    const numberStr = rest[1];
    if (!POSITIVE_INT_RE.test(numberStr)) {
      return { code: 'INVALID_REF', message: 'Pull request number is invalid.' };
    }
    return { kind: 'pull', owner, repo, number: parseInt(numberStr, 10) };
  }

  return { code: 'UNSUPPORTED_PAGE', message: 'Only repository, commit, and pull request pages are supported.' };
}
