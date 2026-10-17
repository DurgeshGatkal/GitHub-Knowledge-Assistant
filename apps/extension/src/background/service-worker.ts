/**
 * background/service-worker.ts — Extension background (service worker).
 *
 * Roles:
 *   1. Receives "analyze" requests from the content script.
 *   2. Calls the backend API (POST /api/analyze → returns job id or cached result).
 *   3. Polls GET /api/jobs/:id until the job is done/failed.
 *   4. Stores the latest job/result in chrome.storage.
 *   5. Notifies the side panel when state changes.
 *
 * All GitHub tokens and API keys stay here — never in the content script or
 * the page. The extension only talks to the backend (localhost in dev).
 */

const API_BASE = 'http://localhost:8787'

export interface PanelState {
  status: 'idle' | 'analyzing' | 'done' | 'error'
  owner?: string
  repo?: string
  sha?: string
  jobId?: string
  graph?: any
  error?: string
}

const DEFAULT_STATE: PanelState = { status: 'idle' }

/** Persisted panel state, shared with the side panel. */
let state: PanelState = { ...DEFAULT_STATE }

/** Side-panel tab id (if open), so we can message it directly. */
let panelTabId: number | null = null

function storageGetPromise(key: string): Promise<any> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result))
  })
}

function storageSetPromise(items: { [key: string]: any }): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve())
  })
}

async function storageGet(): Promise<PanelState> {
  const result = await storageGetPromise('panelState')
  return (result.panelState as PanelState) ?? { ...DEFAULT_STATE }
}

async function storageSet(next: PanelState): Promise<void> {
  state = next
  await storageSetPromise({ panelState: next })
  // Notify the side panel if it's open.
  if (panelTabId) {
    try {
      chrome.tabs.sendMessage(panelTabId, { type: 'STATE_UPDATE', state: next })
    } catch {
      // Panel not ready yet; ignore.
    }
  }
}

/** Call the backend API. */
async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `API error ${res.status}`)
  }
  return res.json()
}

/** Start (or fetch) an analysis job for owner/repo@ref. */
async function analyze(owner: string, repo: string, ref: string): Promise<void> {
  await storageSet({ status: 'analyzing', owner, repo, sha: ref })

  let jobId: string | undefined = undefined
  let graph: any = null

  try {
    const started = await apiFetch('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ owner, repo, ref }),
    })

    if (started.status === 'done') {
      graph = started.result
      await storageSet({
        status: 'done',
        owner,
        repo,
        sha: started.result.sha,
        graph,
      })
      return
    }

    // Cache miss → queued.
    jobId = started.jobId
    await storageSet({ status: 'analyzing', owner, repo, sha: ref, jobId })

    // Poll until done/failed.
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500)) // 1.5 s poll interval
      const job = await apiFetch(`/api/jobs/${jobId}`)
      if (job.status === 'done') {
        graph = job.result
        await storageSet({
          status: 'done',
          owner,
          repo,
          sha: job.result.sha,
          graph,
          jobId,
        })
        return
      }
      if (job.status === 'failed') {
        await storageSet({
          status: 'error',
          owner,
          repo,
          sha: ref,
          jobId,
          error: job.error ?? 'Analysis failed',
        })
        return
      }
    }

    await storageSet({
      status: 'error',
      owner,
      repo,
      sha: ref,
      jobId,
      error: 'Analysis timed out',
    })
  } catch (err: unknown) {
    await storageSet({
      status: 'error',
      owner,
      repo,
      sha: ref,
      jobId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Messages from the content script / side panel. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message as { type: string }

  if (type === 'ANALYZE') {
    void analyze(message.owner, message.repo, message.ref)
    sendResponse({ ok: true })
    return true // keep channel open for async response
  }

  if (type === 'GET_STATE') {
    sendResponse(state)
    return true
  }

  if (type === 'PANEL_READY') {
    panelTabId = sender.tab?.id ?? null
    sendResponse({ ok: true })
    return true
  }

  return false
})

/** Initialize state from storage on startup. */
;(async () => {
  state = await storageGet()
})()
