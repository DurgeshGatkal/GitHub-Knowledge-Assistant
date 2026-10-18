/**
 * src/api.ts — HTTP client for the backend API.
 *
 * All calls go to /api (proxied by Vite in dev, same origin in production).
 */

const API_BASE = '/api'

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
    throw new Error(body.error?.message ?? `API error ${res.status}`)
  }
  return res.json()
}

export interface StartAnalyzeResult {
  status: 'done' | 'queued'
  result?: any
  jobId?: string
  cached?: boolean
}

/** Start (or fetch) an analysis job for a GitHub URL. */
export async function analyze(url: string): Promise<StartAnalyzeResult> {
  return apiFetch('/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ url }),
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
