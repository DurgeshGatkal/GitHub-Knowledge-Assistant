/**
 * content/content-script.ts — Injects the "Analyze Repository" button into
 * GitHub repository pages and wires it to the background service worker.
 *
 * Runs in the page context (isolated world). It does NOT make network calls
 * itself — it messages the background worker, which talks to the API.
 */

import { parsePage, watchNavigation } from './pageDetection.js'

const BUTTON_ID = 'gka-analyze-button'
const PANEL_OPEN_KEY = 'gka-panel-open'

/** Create (or reuse) the analyze button in the repo header. */
function ensureButton(owner: string, repo: string, ref: string): void {
  if (document.getElementById(BUTTON_ID)) return

  // Find the repo header area where action buttons live.
  const header = document.querySelector('[data-testid="repo-header-actions"]')
  if (!header) return

  const btn = document.createElement('button')
  btn.id = BUTTON_ID
  btn.type = 'button'
  btn.className =
    'btn btn-sm btn-primary gka-btn'
  btn.textContent = 'Analyze Repository'
  btn.title = 'Analyze this repository with GitHub Knowledge Assistant'
  btn.style.marginLeft = '8px'
  btn.onclick = () => {
    chrome.runtime.sendMessage({ type: 'ANALYZE', owner, repo, ref })
  }

  header.appendChild(btn)
}

/** Remove the button when navigating away. */
function removeButton(): void {
  const btn = document.getElementById(BUTTON_ID)
  if (btn) btn.remove()
}

let unsubscribe: (() => void) | null = null

function startWatching(): void {
  const info = parsePage(location.href)
  if (info.pageKind !== 'repository') {
    removeButton()
    return
  }
  if (!info.owner || !info.repo) {
    removeButton()
    return
  }
  const ref = info.ref ?? 'main'
  ensureButton(info.owner, info.repo, ref)

  unsubscribe = watchNavigation((next) => {
    if (next.pageKind !== 'repository' || !next.owner || !next.repo) {
      removeButton()
      unsubscribe?.()
      unsubscribe = null
      return
    }
    removeButton()
    const ref = next.ref ?? 'main'
    ensureButton(next.owner, next.repo, ref)
  })
}

startWatching()

// Clean up if the script is re-injected.
window.addEventListener('beforeunload', () => {
  unsubscribe?.()
})
