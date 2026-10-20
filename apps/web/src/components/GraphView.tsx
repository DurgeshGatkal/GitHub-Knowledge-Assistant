/**
 * src/components/GraphView.tsx — React Flow dependency graph.
 *
 * Nodes = files, edges = imports (source → target means "source imports target").
 * Nodes are laid out in columns by dependency depth so the graph is readable
 * without dragging anything. Clicking a node opens a panel with its imports
 * and importers (with line numbers and GitHub links).
 */

import { useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

interface Props {
  graph: any
}

const EDGE_COLORS: Record<string, string> = {
  static: '#94a3b8',
  dynamic: '#f59e0b',
  reexport: '#10b981',
  require: '#3b82f6',
}

const NODE_WIDTH = 190
const NODE_HEIGHT = 52
const COLUMN_GAP = 90
const ROW_GAP = 26

/** Simple layered layout: level = longest path from a node with no importers. */
function layoutNodes(graph: any): Node[] {
  const ids: string[] = graph.nodes.map((n: any) => n.id)

  // Unique file-to-file pairs (multiple import lines between two files only
  // affect layout once).
  const pairs: Array<{ source: string; target: string }> = []
  const seen = new Set<string>()
  for (const e of graph.edges) {
    const key = `${e.source}->${e.target}`
    if (!seen.has(key)) {
      seen.add(key)
      pairs.push({ source: e.source, target: e.target })
    }
  }

  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const { source, target } of pairs) {
    if (!indegree.has(target) || !outgoing.has(source)) continue
    indegree.set(target, (indegree.get(target) ?? 0) + 1)
    outgoing.get(source)!.push(target)
  }

  // Kahn's algorithm: nodes with no importers start in column 0.
  const level = new Map<string, number>(ids.map((id) => [id, 0]))
  const queue = ids.filter((id) => indegree.get(id) === 0)
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const target of outgoing.get(id) ?? []) {
      level.set(target, Math.max(level.get(target) ?? 0, (level.get(id) ?? 0) + 1))
      indegree.set(target, (indegree.get(target) ?? 1) - 1)
      if (indegree.get(target) === 0) queue.push(target)
    }
  }

  // Clamp very deep chains and keep cycle members in column 0.
  const columns = new Map<number, string[]>()
  for (const id of ids) {
    const col = Math.min(level.get(id) ?? 0, 12)
    if (!columns.has(col)) columns.set(col, [])
    columns.get(col)!.push(id)
  }

  const nodes: Node[] = []
  for (const [col, columnIds] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const totalHeight = columnIds.length * (NODE_HEIGHT + ROW_GAP) - ROW_GAP
    columnIds.forEach((id, row) => {
      const source = graph.nodes.find((n: any) => n.id === id)
      const fullPath: string = source?.attributes?.filePath ?? id
      const name = fullPath.split('/').pop() ?? id
      nodes.push({
        id,
        position: {
          x: col * (NODE_WIDTH + COLUMN_GAP),
          y: row * (NODE_HEIGHT + ROW_GAP) - totalHeight / 2,
        },
        data: { label: name, fullPath },
        style: {
          width: NODE_WIDTH,
          fontSize: 11,
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid #bfdbfe',
          background: '#eff6ff',
          color: '#1e3a8a',
        },
      })
    })
  }

  return nodes
}

function buildEdges(graph: any): Edge[] {
  return graph.edges.map((e: any, index: number) => {
    const kind: string = e.attributes.kind ?? 'static'
    const color = EDGE_COLORS[kind] ?? EDGE_COLORS.static
    return {
      id: `${e.source}->${e.target}->${e.attributes.importLine}->${index}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      label: e.attributes.specifier,
      labelStyle: { fontSize: 9, fill: '#475569' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
      style: {
        stroke: color,
        strokeWidth: 1.5,
        strokeDasharray: kind === 'dynamic' ? '5 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      data: { line: e.attributes.importLine, kind },
    }
  })
}

export function GraphView({ graph }: Props) {
  const nodes = useMemo(() => (graph ? layoutNodes(graph) : []), [graph])
  const edges = useMemo(() => (graph ? buildEdges(graph) : []), [graph])
  const [selected, setSelected] = useState<string | null>(null)

  const detail = useMemo(() => {
    if (!graph || !selected) return null
    return {
      file: selected,
      imports: graph.edges.filter((e: any) => e.source === selected),
      importers: graph.edges.filter((e: any) => e.target === selected),
    }
  }, [graph, selected])

  const githubUrl = (file: string) =>
    `https://github.com/${graph.owner}/${graph.repo}/blob/${graph.sha}/${file}`

  return (
    <div className="flex flex-1 flex-col lg:flex-row min-h-[600px] gap-3 p-3">
      <div className="flex-1 min-w-0 border border-gray-200 rounded-lg bg-white overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable
          nodesConnectable={false}
          onNodeClick={(_, node) => setSelected(node.id)}
          onPaneClick={() => setSelected(null)}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>

      {detail && (
        <aside className="w-full lg:w-80 shrink-0 border border-gray-200 rounded-lg bg-white p-4 overflow-y-auto max-h-[calc(100vh-120px)]">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 break-all">{detail.file}</h2>
            <button
              onClick={() => setSelected(null)}
              className="text-gray-400 hover:text-gray-600 text-xs"
              aria-label="Close details"
            >
              ✕
            </button>
          </div>

          <a
            href={githubUrl(detail.file)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline"
          >
            View file on GitHub →
          </a>

          <section className="mt-4">
            <h3 className="text-xs font-semibold text-gray-700 mb-2">
              Imports ({detail.imports.length})
            </h3>
            {detail.imports.length === 0 ? (
              <p className="text-xs text-gray-400">This file imports nothing.</p>
            ) : (
              <ul className="space-y-2">
                {detail.imports.map((e: any, i: number) => (
                  <li key={i} className="text-xs">
                    <button
                      onClick={() => setSelected(e.target)}
                      className="text-blue-700 hover:underline break-all text-left"
                    >
                      {e.target}
                    </button>
                    <div className="text-gray-500">
                      line {e.attributes.importLine} · {e.attributes.kind} · {e.attributes.specifier}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-4">
            <h3 className="text-xs font-semibold text-gray-700 mb-2">
              Imported by ({detail.importers.length})
            </h3>
            {detail.importers.length === 0 ? (
              <p className="text-xs text-gray-400">No file imports this one.</p>
            ) : (
              <ul className="space-y-2">
                {detail.importers.map((e: any, i: number) => (
                  <li key={i} className="text-xs">
                    <button
                      onClick={() => setSelected(e.source)}
                      className="text-blue-700 hover:underline break-all text-left"
                    >
                      {e.source}
                    </button>
                    <div className="text-gray-500">
                      line {e.attributes.importLine} · {e.attributes.importKind ?? e.attributes.kind}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      )}
    </div>
  )
}
