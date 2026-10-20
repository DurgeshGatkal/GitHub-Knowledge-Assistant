/**
 * src/api.ts — HTTP client for the backend API.
 *
 * Paths below are absolute API paths ("/api/..."). The base URL only changes
 * where those paths are sent:
 *   - dev:      http://localhost:8787  (API server directly, CORS is allowed)
 *   - prod:     same origin (Fastify serves both the site and /api)
 *   - override: VITE_API_BASE, e.g. "https://api.example.com"
 *
 * NOTE: do not add "/api" to both the base and the paths — that produces
 * /api/api/analyze and Fastify answers 404 "Not found".
 */

const API_BASE: string = import.meta.env.DEV
  ? 'http://localhost:8787'
  : (import.meta.env.VITE_API_BASE ?? '')

async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string | { code?: string; message?: string }
    }
    const message =
      typeof body.error === 'string'
        ? body.error
        : body.error?.message
    throw new Error(message ?? `API error ${res.status}`)
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

/** Fetch a single job record. */
export async function getJob(jobId: string): Promise<any> {
  return apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`)
}

/** Poll a job until done/failed or maxAttempts reached. */
export async function pollJob(
  jobId: string,
  { intervalMs = 1500, maxAttempts = 80 }: { intervalMs?: number; maxAttempts?: number } = {}
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const job = await getJob(jobId)
    if (job.status === 'done' || job.status === 'failed') return job
  }
  throw new Error('Analysis timed out')
}

/** Fetch a cached graph directly. */
export async function getGraph(owner: string, repo: string, sha: string): Promise<any> {
  return apiFetch(`/api/graph/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(sha)}`)
}
