/**
 * src/hooks/usePolling.ts — Poll a job until done/failed.
 */

import { useEffect, useState, useCallback } from 'react'
import { pollJob } from '../api.js'

export interface JobState {
  status: 'idle' | 'polling' | 'done' | 'error'
  jobId?: string
  result?: any
  error?: string
}

export function usePolling(jobId: string | undefined, enabled = true) {
  const [state, setState] = useState<JobState>({
    status: jobId ? 'polling' : 'idle',
    jobId,
  })

  const start = useCallback(async (id: string) => {
    setState({ status: 'polling', jobId: id })
    try {
      const job = await pollJob(id)
      if (job.status === 'done') {
        setState({ status: 'done', jobId: id, result: job.result })
      } else {
        setState({ status: 'error', jobId: id, error: job.error ?? 'Analysis failed' })
      }
    } catch (err: unknown) {
      setState({
        status: 'error',
        jobId: id,
        error: err instanceof Error ? err.message : 'Polling failed',
      })
    }
  }, [])

  useEffect(() => {
    if (!enabled || !jobId) return
    void start(jobId)
  }, [jobId, enabled, start])

  return state
}
