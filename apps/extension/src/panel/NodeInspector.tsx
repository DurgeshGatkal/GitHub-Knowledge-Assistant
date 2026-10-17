/**
 * panel/NodeInspector.tsx — Shows details for a selected graph node:
 * the file, its imports, what imports it, and a "go to line" GitHub link.
 */

import { useEffect, useState } from 'react'
import type { GraphAnalysis } from './types.js'

interface Props {
  nodeId: string | null
  graph: GraphAnalysis | null
}

export function NodeInspector({ nodeId, graph }: Props) {
  if (!graph || !nodeId) {
    return (
      <div className="p-4 border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
        Select a file in the graph to inspect it.
      </div>
    )
  }

  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) {
    return (
      <div className="p-4 border-t border-gray-200 bg-gray-50 text-sm text-gray-600">
        File not found in graph.
      </div>
    )
  }

  const incoming = graph.edges.filter((e) => e.target === nodeId)
  const outgoing = graph.edges.filter((e) => e.source === nodeId)
  const { filePath } = node.attributes
  const blobUrl = `https://github.com/${graph.owner}/${graph.repo}/blob/${graph.sha}/${filePath}`

  return (
    <div className="p-4 border-t border-gray-200 bg-white">
      <div className="flex items-center gap-2 mb-2">
        <a
          href={blobUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 hover:underline truncate max-w-full"
          title={filePath}
        >
          {filePath}
        </a>
        <span className="text-xs text-gray-400">{node.attributes.sizeBytes} bytes</span>
      </div>

      <div className="grid grid-cols-1 gap-2 text-xs">
        <div className="p-2 bg-blue-50 rounded border border-blue-100">
          <div className="text-xs text-blue-600 font-semibold mb-1">Imports ({outgoing.length})</div>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            {outgoing.map((e) => (
              <li key={`${e.source}->${e.target}`}>
                {e.attributes.specifier} (line {e.attributes.importLine}, {e.attributes.kind})
              </li>
            ))}
            {outgoing.length === 0 && <li className="text-gray-400 italic">none</li>}
          </ul>
        </div>
        <div className="p-2 bg-purple-50 rounded border border-purple-100">
          <div className="text-xs text-purple-600 font-semibold mb-1">Imported by ({incoming.length})</div>
          <ul className="list-disc list-inside text-gray-700 space-y-1">
            {incoming.map((e) => (
              <li key={`${e.source}->${e.target}`}>
                {e.source} (line {e.attributes.importLine})
              </li>
            ))}
            {incoming.length === 0 && <li className="text-gray-400 italic">none</li>}
          </ul>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-2">
        Open on GitHub: <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">view file</a>
      </p>
    </div>
  )
}
