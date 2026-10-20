/**
 * src/pages/PRResults.tsx — Pull Request results page.
 *
 * Shows PR impact findings grouped by label (Confirmed / Inferred / Unverified)
 * with evidence chains and "go to line" links.
 */

import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { analyze, pollJob } from '../api.js'

interface PRChangedFile {
  filename: string
  previous_filename?: string
  status: string
  additions: number
  deletions: number
  changes: number
}

interface AffectedFile {
  file: string
  depth: number
  status: 'confirmed' | 'inferred' | 'unverified'
  viaChangedFiles: string[]
  chain: Array<{
    from: string
    to: string
    importLine: number
    kind: string
    specifier: string
  }>
}

interface TestMatch {
  testFile: string
  status: 'confirmed' | 'inferred' | 'unverified'
  rules: string[]
  reason: string
  viaChangedFiles: string[]
}

interface UnresolvedLink {
  sourceFile: string
  specifier: string
  importLine: number
  kind: string
}

interface PRResult {
  number: number
  title: string
  state: string
  headSha: string
  baseSha: string
  changedFiles: PRChangedFile[]
  impact: {
    changedFiles: string[]
    affectedFiles: AffectedFile[]
    testMatches: TestMatch[]
    unresolvedLinks: UnresolvedLink[]
    stats: {
      depthLimit: number
      visitedCount: number
      confirmedCount: number
      inferredCount: number
      unverifiedCount: number
      beyondDepthCount: number
      unresolvedLinkCount: number
    }
  }
}

export function PRResults() {
  const { owner, repo, number } = useParams<{
    owner: string
    repo: string
    number: string
  }>()
  const navigate = useNavigate()
  const location = useLocation()
  // When coming from the job page the finished result is passed along, so the
  // page renders immediately instead of analysing the PR a second time.
  const initialResult =
    (location.state as { result?: PRResult } | null)?.result ?? null
  const [pr, setPr] = useState<PRResult | null>(initialResult)
  const [error, setError] = useState('')

  useEffect(() => {
    // Already have a result from the job page.
    if (initialResult) return

    if (!owner || !repo || !number) {
      setError('Missing repository information')
      return
    }

    const prNum = parseInt(number, 10)
    if (isNaN(prNum)) {
      setError('Invalid PR number')
      return
    }

    ;(async () => {
      try {
        // Start impact analysis for the PR
        const started = await analyze(
          `https://github.com/${owner}/${repo}/pull/${prNum}`
        )

        if (started.status === 'done') {
          setPr(started.result as PRResult)
        } else if (started.jobId) {
          const job = await pollJob(started.jobId, {
            intervalMs: 1500,
            maxAttempts: 60,
          })

          if (job.status === 'done') {
            setPr(job.result as PRResult)
          } else if (job.status === 'failed') {
            setError(job.error || 'PR analysis failed')
          }
        } else {
          setError('PR analysis did not return a job')
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load PR results')
      }
    })()
  }, [owner, repo, number, initialResult])

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

  if (!pr) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Analyzing pull request…</p>
          <p className="text-xs text-gray-400 mt-2">Fetching changed files and building impact graph</p>
        </div>
      </div>
    )
  }

  const { impact } = pr
  const confirmed = pr.impact.affectedFiles.filter((f) => f.status === 'confirmed')
  const inferred = pr.impact.affectedFiles.filter((f) => f.status === 'inferred')
  const unverified = pr.impact.affectedFiles.filter((f) => f.status === 'unverified')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              PR #{pr.number} &nbsp;
              <span className="text-sm font-normal text-gray-500">
                {owner}/{repo}
              </span>
            </h1>
            <p className="text-sm text-gray-500">{pr.title}</p>
            <p className="text-xs text-gray-400 mt-1">
              Base: {pr.baseSha.slice(0, 7)} &nbsp;→&nbsp; Head: {pr.headSha.slice(0, 7)}
            </p>
            <a
              href={`https://github.com/${owner}/${repo}/pull/${pr.number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Open PR on GitHub →
            </a>
          </div>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Analyze Another
          </button>
        </div>
      </header>

      {/* Unverified count banner */}
      {pr.impact.stats.unresolvedLinkCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-700 font-medium">⚠️</span>
            <span className="text-amber-800 text-sm">
              {pr.impact.stats.unresolvedLinkCount} unresolved link(s) could not be resolved.
            </span>
          </div>
        </div>
      )}

      <div className="p-6">
        {/* Changed files */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Changed Files</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">+ / -</th>
                </tr>
              </thead>
              <tbody>
                {pr.changedFiles.map((f) => (
                  <tr key={f.filename} className="border-b border-gray-100">
                    <td className="px-3 py-2">{f.filename}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          f.status === 'added'
                            ? 'bg-green-100 text-green-700'
                            : f.status === 'modified'
                            ? 'bg-blue-100 text-blue-700'
                            : f.status === 'deleted'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}
                      >
                        {f.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{f.additions} / {f.deletions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Findings summary */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="bg-white p-4 border border-gray-200 rounded">
            <div className="text-xs text-gray-500">Confirmed</div>
            <div className="text-2xl font-bold text-green-600">{confirmed.length}</div>
          </div>
          <div className="bg-white p-4 border border-gray-200 rounded">
            <div className="text-xs text-gray-500">Inferred</div>
            <div className="text-2xl font-bold text-yellow-600">{inferred.length}</div>
          </div>
          <div className="bg-white p-4 border border-gray-200 rounded">
            <div className="text-xs text-gray-500">Unverified</div>
            <div className="text-2xl font-bold text-red-600">{unverified.length}</div>
          </div>
        </div>

        {/* Affected files by label */}
        {[
          { label: 'Confirmed', color: 'green', items: confirmed },
          { label: 'Inferred', color: 'yellow', items: inferred },
          { label: 'Unverified', color: 'red', items: unverified },
        ].map((group) => (
          <div key={group.label} className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">
              {group.label} ({group.items.length})
            </h3>
            <div className="space-y-2">
              {group.items.map((f) => (
                <div key={f.file} className="bg-white p-3 border border-gray-200 rounded">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium text-gray-900">{f.file}</span>
                    <span className={`text-xs font-medium rounded-full ${
                      f.status === 'confirmed'
                        ? 'bg-green-100 text-green-700'
                        : f.status === 'inferred'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {f.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 mb-2">
                    Depth: {f.depth} &nbsp;|&nbsp; Via: {f.viaChangedFiles.join(', ')}
                  </div>
                  <div className="text-xs text-gray-700 mb-2">
                    Evidence Chain:
                  </div>
                  <div className="pl-4 space-y-1">
                    {f.chain.map((link, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-xs text-gray-400">{i + 1}.</span>
                        <span className="text-xs text-gray-700">
                          {link.from} → {link.to} (line {link.importLine})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Test matches */}
        {pr.impact.testMatches.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Tests That Import Affected Code
            </h2>
            <div className="space-y-2">
              {pr.impact.testMatches.map((t) => (
                <div key={t.testFile} className="bg-white p-3 border border-gray-200 rounded">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-sm font-medium text-gray-900">{t.testFile}</span>
                    <span className={`text-xs font-medium rounded-full ${
                      t.status === 'confirmed'
                        ? 'bg-green-100 text-green-700'
                        : t.status === 'inferred'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {t.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">{t.reason}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Rules: {t.rules.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unresolved links */}
        {pr.impact.unresolvedLinks.length > 0 && (
          <div className="mb-6 bg-amber-50 p-4 border border-amber-200 rounded">
            <h2 className="text-lg font-semibold text-amber-900 mb-3">
              Unresolved Links
            </h2>
            <div className="space-y-2">
              {pr.impact.unresolvedLinks.map((u) => (
                <div key={`${u.sourceFile}:${u.importLine}`} className="text-sm text-gray-700">
                  {u.sourceFile} (line {u.importLine}): {u.specifier}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
