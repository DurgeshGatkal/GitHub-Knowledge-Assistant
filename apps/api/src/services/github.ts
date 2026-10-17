/**
 * github.ts — Lightweight GitHub helpers used by the API.
 *
 * Resolves a user-supplied ref (branch name, tag, or SHA) to an exact commit
 * SHA, because the cache is keyed by SHA and a SHA is immutable/cacheable.
 *
 * Only public repos are supported unless GITHUB_TOKEN is set.
 */

const GITHUB_API = 'https://api.github.com';

/**
 * Resolve `ref` to a full commit SHA.
 *   - If `ref` already looks like a 40-hex SHA, return it unchanged.
 *   - Otherwise query the GitHub commits endpoint for the ref and return the
 *     object's `sha`.
 *
 * Returns null when the repo/ref does not exist or the request fails.
 */
export async function resolveRefToSha({
  owner,
  repo,
  ref,
  githubToken,
}: {
  owner: string;
  repo: string;
  ref: string;
  githubToken?: string;
}): Promise<string | null> {
  // SHA heuristic: 40 lowercase hex characters.
  if (/^[0-9a-f]{40}$/.test(ref)) return ref;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-intelligence-extension/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }

  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}/commits/${encodeURIComponent(ref)}`,
      { headers }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { sha?: string };
    return data.sha ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate that `owner/repo` exists on GitHub (public or via token).
 */
export async function repoExists({
  owner,
  repo,
  githubToken,
}: {
  owner: string;
  repo: string;
  githubToken?: string;
}): Promise<boolean> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'github-intelligence-extension/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) {
    headers['Authorization'] = `Bearer ${githubToken}`;
  }
  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
        repo
      )}`,
      { headers }
    );
    return res.ok;
  } catch {
    return false;
  }
}
