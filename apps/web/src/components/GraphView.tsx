/**
 * src/components/GraphView.tsx — React Flow dependency graph.
 *
 * Nodes = files, edges = imports (source → target means "source imports target").
 * Clicking a node shows its imports / importers with line numbers.
 */

import { useMemo } from 'react'
import {
  Edge,
  Node,
  ReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  Background,
  Controls,
  MiniMap,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

interface Props {
  graph: any
}

export function GraphView({ graph }: Props) {
  const flowElements = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] }

    const flowNodes: Node[] = graph.nodes.map((n: any) => ({
      id: n.id,
      position: { x: 0, y: 0 },
      data: {
        label: n.attributes.filePath.split('/').pop() ?? n.id,
        fullPath: n.attributes.filePath,
      },
    }))

    const flowEdges: Edge[] = graph.edges.map((e: any) => ({
      id: `${e.source}->${e.target}->${e.attributes.importLine}`,
      source: e.source,
      target: e.target,
      type: 'step',
      label: e.attributes.specifier,
      data: { line: e.attributes.importLine, kind: e.attributes.kind },
    }))

    return { nodes: flowNodes, edges: flowEdges }
  }, [graph])

  return (
    <div className="flex-1 border border-gray-200 rounded-lg bg-white">
      <ReactFlow
        nodes={flowElements.nodes}
        edges={flowElements.edges}
        onNodesChange={(changes) => applyNodeChanges(changes, flowElements.nodes)}
        onEdgesChange={(changes) => applyEdgeChanges(changes, flowElements.edges)}
        onConnect={(params) => addEdge(params, flowElements.edges)}
        panOnScroll
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2}
        nodeTypes={{
          file: ({ id, data }) => (
            <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 text-center max-w-[140px] break-words cursor-pointer hover:bg-blue-100 transition">
              {data.label}
            </div>
          ),
        }}
        edgeTypes={{
          step: () => (
            <g>
              <path
                stroke="#9ca3af"
                strokeWidth={1.5}
                fill="none"
                markerEnd="url(#arrowhead)"
              />
            </g>
          ),
        }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
