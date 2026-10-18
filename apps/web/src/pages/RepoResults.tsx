/**
 * src/pages/RepoResults.tsx — Repository results page.
 *
 * Shows the dependency graph (React Flow) for a repository at a given SHA.
 * Clicking a node shows its imports / importers with line numbers.
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { usePolling } from '../hooks/usePolling.js'
import { getGraph, analyze } from '../api.js'
import { GraphView } from '../components/GraphView.js'

export function RepoResults() {
  const { owner, repo, sha } = useParams<{ owner: string; repo: string; sha: string }>()
  const navigate = useNavigate()
  const [graph, setGraph] = useState<any>(null)
  const [error, setError] = useState('')

  const { status, result } = usePolling(
    owner && repo && sha ? `repo-${owner}-${repo}-${sha}` : undefined,
    Boolean(owner && repo && sha)
  )

  useEffect(() => {
    if (!owner || !repo || !sha) {
      setError('Missing repository information')
      return
    }

    ;(async () => {
      try {
        const cached = await getGraph(owner, repo, sha)
        setGraph(cached)
      } catch {
        // Graph not cached yet — start a new analysis
        try {
          const started = await analyze(`https://github.com/${owner}/${repo}@${sha}`)
          if (started.status === 'done') {
            setGraph(started.result)
          }
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : 'Failed to load graph')
        }
      }
    })()
  }, [owner, repo, sha])

  useEffect(() => {
    if (result && status === 'done') {
      setGraph(result)
    }
  }, [result, status])

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900">Error</h2>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => navigate('/')}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!graph) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading repository graph…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {owner}/{repo}
            </h1>
            <p className="text-sm text-gray-500">
              Commit: {(sha ?? '').slice(0, 7)}
            </p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Analyze Another
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)]">
        <GraphView graph={graph} />
      </div>

      <footer className="bg-white border-t border-gray-200 px-6 py-3 text-xs text-gray-500">
        {graph.stats.totalFiles} files • {graph.stats.totalEdges} imports •{' '}
        {graph.stats.unresolvedCount} unresolved
      </footer>
    </div>
  )
}
