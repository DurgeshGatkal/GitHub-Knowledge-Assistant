/**
 * src/pages/Landing.tsx — Landing page with URL input.
 *
 * User pastes a GitHub URL and clicks Analyze. The app validates the URL
 * client-side for instant feedback, then starts a job on the backend.
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyze } from '../api.js'
export function Landing() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('idle')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('analyzing')
    setError('')
    try {
      const result = await analyze(url.trim())
      if (result.status === 'done') {
        navigate(`/repo/${encodeURIComponent(result.result.owner)}/${encodeURIComponent(result.result.repo)}/${encodeURIComponent(result.result.sha)}`)
      } else {
        navigate(`/job/${result.jobId}`)
      }
    } catch (err: unknown) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to start analysis')
    }
  }, [url, navigate])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">GitHub Knowledge Assistant</h1>
        <p className="text-gray-600 mb-8">
          Paste a GitHub repository URL to see its dependency graph and change impact.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Repository URL
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={status === 'analyzing' || !url.trim()}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-md font-medium hover:bg-blue-700 disabled:bg-gray-400"
          >
            {status === 'analyzing' ? 'Analyzing…' : 'Analyze Repository'}
          </button>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mt-6 border-t border-gray-200 pt-4">
            <p className="text-xs text-gray-500 mb-3">Try these examples:</p>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setUrl('https://github.com/sindresorhus/is')}
                className="text-left text-xs text-blue-600 hover:underline px-2"
              >
                sindresorhus/is
              </button>
              <button
                type="button"
                onClick={() => setUrl('https://github.com/facebook/react/tree/main')}
                className="text-left text-xs text-blue-600 hover:underline px-2"
              >
                facebook/react (main branch)
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
