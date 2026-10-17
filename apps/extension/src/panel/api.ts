/**
 * panel/api.ts — HTTP client for the backend API.
 *
 * All calls go to http://localhost:8787 (configurable via env at build time).
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787'

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

export interface StartAnalyzeResult {
  status: 'done' | 'queued'
  result?: any
  jobId?: string
}

/** Start (or fetch) an analysis job for owner/repo@ref. */
export async function analyze(owner: string, repo: string, ref: string): Promise<StartAnalyzeResult> {
  return apiFetch('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ owner, repo, ref }),
  })
}

/** Poll a job until done/failed or maxAttempts reached. */
export async function pollJob(
  jobId: string,
  { intervalMs = 1500, maxAttempts = 80 }: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const job = await apiFetch(`/api/jobs/${jobId}`)
    if (job.status === 'done' || job.status === 'failed') return job
  }
  throw new Error('Analysis timed out')
}

/** Fetch a cached graph directly. */
export async function getGraph(owner: string, repo: string, sha: string): Promise<any> {
  return apiFetch(`/api/graph/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(sha)}`)
}
