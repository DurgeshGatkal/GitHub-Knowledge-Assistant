/**
 * resolveRef.ts — Resolve a branch/tag/ref to an exact commit SHA.
 *
 * A pasted URL usually contains a branch name (or nothing), not a SHA.
 * Everything downstream (tarball fetch, cache key, permalinks) depends on a
 * SHA, so we must resolve it via the GitHub API.
 */

export interface RefResolverDeps {
  /** Fetch function (injected so tests stay offline). */
  fetch: typeof fetch;
  /** Optional GitHub token (backend only). */
  githubToken?: string;
}

export interface ResolveRefResult {
  /** The resolved 40-character commit SHA. */
  sha: string;
  /** The ref that was resolved (branch name, tag, or SHA). */
  ref: string;
  /** Whether the ref was already a SHA (no network call needed). */
  fromSha: boolean;
}

export type RefErrorCode =
  | 'REPO_NOT_FOUND'
  | 'REF_NOT_FOUND'
  | 'GITHUB_RATE_LIMITED'
  | 'EMPTY_REPO'
  | 'NETWORK_ERROR';

export interface RefError {
  code: RefErrorCode;
  message: string;
}

export type ResolveRefResultOrError = ResolveRefResult | RefError;

const GITHUB_API = 'https://api.github.com';

const SHA_RE = /^[0-9a-f]{40}$/;
const SHORT_SHA_RE = /^[0-9a-f]{7,39}$/;

/**
 * Build standard GitHub API headers.
 */
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
 * Resolve a ref to a commit SHA.
 *
 * - If ref is already a 40-hex SHA, return it directly (no network).
 * - If ref is empty/undefined, resolve the repo's default_branch.
 * - Otherwise call /repos/{owner}/{repo}/commits/{ref}.
 * - For branch names with slashes, try progressively longer prefixes.
 */
export async function resolveRef(
  owner: string,
  repo: string,
  ref: string | undefined,
  deps: RefResolverDeps
): Promise<ResolveRefResultOrError> {
  const { fetch: fetchFn, githubToken } = deps;

  // ── Already a full SHA ──
  if (ref && SHA_RE.test(ref)) {
    return { sha: ref, ref, fromSha: true };
  }

  const headers = githubHeaders(githubToken);

  // ── No ref: look up the default branch name, then resolve it to a SHA ──
  //
  // The repo endpoint only returns a branch *name* ("main"). Everything
  // downstream (tarball fetch, cache key, permalinks) needs a commit SHA, so
  // the name is resolved through the commits endpoint below.
  if (!ref) {
    try {
      const res = await fetchFn(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { headers }
      );
      if (res.status === 404) {
        return { code: 'REPO_NOT_FOUND', message: 'Repository not found or private.' };
      }
      if (res.status === 403) {
        return { code: 'GITHUB_RATE_LIMITED', message: 'GitHub API rate limit exceeded.' };
      }
      if (!res.ok) {
        return { code: 'NETWORK_ERROR', message: `GitHub API error ${res.status}` };
      }
      const data = (await res.json()) as { default_branch?: string };
      if (!data.default_branch) {
        return { code: 'EMPTY_REPO', message: 'Repository has no default branch.' };
      }
      ref = data.default_branch;
    } catch {
      return { code: 'NETWORK_ERROR', message: 'Failed to reach GitHub API.' };
    }
  }

  // ── Resolve the branch/tag name to a commit SHA ──
  // Handle slash branches by trying progressively longer prefixes.
  const candidates = slashBranchCandidates(ref);

  for (const candidate of candidates) {
    try {
      const res = await fetchFn(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(candidate)}`,
        { headers }
      );

      if (res.status === 404) {
        continue; // try next candidate
      }
      if (res.status === 403) {
        return { code: 'GITHUB_RATE_LIMITED', message: 'GitHub API rate limit exceeded.' };
      }
      if (!res.ok) {
        return { code: 'NETWORK_ERROR', message: `GitHub API error ${res.status}` };
      }

      const data = (await res.json()) as { sha?: string };
      if (data.sha) {
        return { sha: data.sha, ref: candidate, fromSha: false };
      }
    } catch {
      return { code: 'NETWORK_ERROR', message: 'Failed to reach GitHub API.' };
    }
  }

  return { code: 'REF_NOT_FOUND', message: `Branch or tag "${ref}" not found.` };
}

/**
 * Generate candidate refs for branch names containing slashes.
 * Tries the full ref first, then shorter prefixes as fallback.
 * e.g. "feature/login/src" -> ["feature/login/src", "feature/login", "feature"]
 */
function slashBranchCandidates(ref: string): string[] {
  if (!ref.includes('/')) {
    return [ref];
  }
  const parts = ref.split('/');
  const candidates: string[] = [];
  for (let i = parts.length; i >= 1; i--) {
    candidates.push(parts.slice(0, i).join('/'));
  }
  return candidates;
}
