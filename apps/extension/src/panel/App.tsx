/**
 * panel/App.tsx — Side panel root.
 *
 * Talks to the background service worker (via chrome.runtime.sendMessage) to
 * start analyses and receive state updates. Renders the graph + inspector.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PanelState } from './types.js'
import { GraphView } from './GraphView.js'

function sendMessage(message: any): Promise<any> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response))
  })
}

export function App() {
  const [state, setState] = useState<PanelState>({ status: 'idle' })

  // Fetch current state on mount.
  useEffect(() => {
    void sendMessage({ type: 'GET_STATE' }).then((s: PanelState) => setState(s ?? { status: 'idle' }))
  }, [])

  // Listen for state updates broadcast by the background worker.
  useEffect(() => {
    const handler = (message: any) => {
      if (message.type === 'STATE_UPDATE') setState(message.state)
    }
    chrome.runtime.onMessage.addListener(handler as any)
    // Tell the background worker this panel is ready.
    void sendMessage({ type: 'PANEL_READY' })
    return () => chrome.runtime.onMessage.removeListener(handler as any)
  }, [])

  const startAnalyze = useCallback(async () => {
    if (!state.owner || !state.repo) return
    setState({ ...state, status: 'analyzing' })
    try {
      const started = await sendMessage({
        type: 'ANALYZE',
        owner: state.owner,
        repo: state.repo,
        ref: state.sha ?? 'main',
      })
      // Background worker handles polling and state updates; we just re-read state.
      const updated = await sendMessage({ type: 'GET_STATE' })
      setState(updated ?? { status: 'idle' })
    } catch (err: unknown) {
      setState({
        ...state,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [state.owner, state.repo, state.sha])

  const handleAnalyze = () => {
    if (state.status === 'done' || state.status === 'error') {
      setState({ status: 'idle' })
    } else {
      void startAnalyze()
    }
  }

  const onNodeSelect = useCallback((nodeId: string | null) => {}, [])

  const isIdle = state.status === 'idle'

  return (
    <div className="p-4 flex flex-col h-full gap-4 font-sans text-sm">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold text-gray-900">Knowledge Assistant</h1>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          state.status === 'analyzing'
            ? 'bg-blue-100 text-blue-700 animate-pulse'
            : state.status === 'done'
            ? 'bg-green-100 text-green-700'
            : state.status === 'error'
            ? 'bg-red-100 text-red-700'
            : 'bg-gray-100 text-gray-500'
        }`}>
          {state.status === 'analyzing' ? 'Analyzing…' : state.status === 'done' ? 'Ready' : state.status === 'error' ? 'Error' : 'Idle'}
        </span>
      </div>

      {state.error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
          {state.error}
        </div>
      )}

      <div className="text-xs text-gray-500 mb-1">
        {state.owner && state.repo
          ? `${state.owner}/${state.repo}` + (state.sha ? ` @ ${state.sha.slice(0, 7)}` : '')
          : 'No repository selected'}
      </div>

      <button
        onClick={handleAnalyze}
        disabled={isIdle && (!state.owner || !state.repo) || state.status === 'analyzing'}
        className={`w-full px-4 py-2 rounded text-sm font-medium transition ${
          isIdle && state.owner && state.repo
            ? 'bg-blue-600 text-white hover:bg-blue-700'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
        }`}
      >
        {state.status === 'analyzing' ? 'Analyzing…' : isIdle ? 'Analyze Repository' : 'Reset'}
      </button>

      <div className="flex-1 min-h-[300px]">
        <GraphView graph={state.graph ?? null} onNodeSelect={onNodeSelect} />
      </div>

      {state.graph && state.status === 'done' && (
        <div className="text-xs text-gray-500">
          {state.graph.stats.totalFiles} files • {state.graph.stats.totalEdges} imports •{' '}
          {state.graph.stats.unresolvedCount} unresolved
        </div>
      )}
    </div>
  )
}
