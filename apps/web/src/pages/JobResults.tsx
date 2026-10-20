/**
 * src/pages/JobResults.tsx — Job polling page.
 *
 * Shows polling state for a job that was just started, then redirects to
 * the results page when done.
 */

import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePolling } from '../hooks/usePolling.js'

export function JobResults() {
  const navigate = useNavigate()
  const { jobId } = useParams<{ jobId: string }>()
  const { status, result, error } = usePolling(jobId ?? undefined, true)

  useEffect(() => {
    if (status !== 'done' || !result) return

    // PR results carry an `impact`; repository results carry nodes/edges.
    if (result.impact && result.number) {
      navigate(
        `/pr/${encodeURIComponent(result.owner)}/${encodeURIComponent(result.repo)}/${encodeURIComponent(result.number)}`,
        { state: { result } }
      )
      return
    }

    navigate(
      `/repo/${encodeURIComponent(result.owner)}/${encodeURIComponent(result.repo)}/${encodeURIComponent(result.sha)}`
    )
  }, [status, result, navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        {status === 'polling' ? (
          <>
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600">Analyzing repository…</p>
            <p className="text-xs text-gray-400 mt-2">This may take a minute for large repositories.</p>
          </>
        ) : status === 'done' ? (
          <>
            <div className="text-green-600 mb-4">✓ Analysis complete</div>
            <p className="text-gray-600">Loading results…</p>
          </>
        ) : (
          <>
            <div className="text-red-600 mb-4">Analysis failed</div>
            <p className="text-gray-600">{error || 'Unknown error'}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Back to Home
            </button>
          </>
        )}
      </div>
    </div>
  )
}
