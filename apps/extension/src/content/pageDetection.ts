/**
 * content/pageDetection.ts — Detect which GitHub page the user is on.
 *
 * GitHub is a single-page app: the URL changes without a full reload, so we
 * must re-parse on every navigation (history.pushState/popstate + DOM
 * mutations). This module is framework-free so it can be unit-tested in
 * isolation.
 */

export interface PageInfo {
  /** 'repository' | 'pull_request' | 'other' */
  pageKind: 'repository' | 'pull_request' | 'other'
  /** Repo owner, e.g. 'facebook' */
  owner?: string
  /** Repo name, e.g. 'react' */
  repo?: string
  /** Ref shown in the URL (branch, tag, or commit SHA), if any */
  ref?: string
  /** Full URL */
  url: string
}

const REPO_PATH_RE = /^\/([^/]+)\/([^/]+)(\/tree\/([^/?#]+))?(\/blob\/([^/?#]+))?/

/** Parse a GitHub URL into structured page info. */
export function parsePage(url: string): PageInfo {
  try {
    const u = new URL(url)
    if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') {
      return { pageKind: 'other', url }
    }
    const m = u.pathname.match(REPO_PATH_RE)
    if (!m) return { pageKind: 'other', url }

    const owner = m[1]
    const repo = m[2]
    const treeRef = m[4]
    const blobRef = m[6]

    if (u.pathname.includes('/pull/')) {
      return { pageKind: 'pull_request', owner, repo, url }
    }

    return {
      pageKind: 'repository',
      owner,
      repo,
      ref: treeRef ?? blobRef,
      url,
    }
  } catch {
    return { pageKind: 'other', url }
  }
}

/**
 * Watch for SPA navigation and call `onChange` with the latest page info.
 * Returns an unsubscribe function.
 */
/**
 * Watch for SPA navigation and call `onChange` with the latest page info.
 * Returns an unsubscribe function.
 *
 * `getUrl` is injected (defaults to `() => location.href`) so the function can
 * be unit-tested without a real browser location.
 */
export function watchNavigation(
  onChange: (info: PageInfo) => void,
  getUrl: () => string = () => location.href
): () => void {
  let current = parsePage(getUrl())
  onChange(current)

  const handleChange = () => {
    const next = parsePage(getUrl())
    if (
      next.owner !== current.owner ||
      next.repo !== current.repo ||
      next.ref !== current.ref
    ) {
      current = next
      onChange(next)
    }
  }

  const origPushState = history.pushState
  const origReplaceState = history.replaceState
  history.pushState = function (...args: any[]) {
    ;(origPushState as any).apply(history, args)
    handleChange()
  } as any
  history.replaceState = function (...args: any[]) {
    ;(origReplaceState as any).apply(history, args)
    handleChange()
  } as any
  window.addEventListener('popstate', handleChange)

  const observer = new MutationObserver(() => {
    const next = parsePage(getUrl())
    if (next.url !== current.url) {
      current = next
      onChange(next)
    }
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  return () => {
    history.pushState = origPushState
    history.replaceState = origReplaceState
    window.removeEventListener('popstate', handleChange)
    observer.disconnect()
  }
}
