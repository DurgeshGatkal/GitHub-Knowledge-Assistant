/**
 * panel/GraphView.tsx — React Flow dependency graph.
 *
 * Nodes = files, edges = imports (source → target means "source imports target").
 * Clicking a node opens the inspector with the file and its import relationships.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { GraphAnalysis } from './types.js'
import { NodeInspector } from './NodeInspector.js'

interface Props {
  graph: GraphAnalysis | null
  onNodeSelect: (nodeId: string | null) => void
}

export function GraphView({ graph, onNodeSelect }: Props) {
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedNode, setSelectedNode] = useState<string | null>(null)

  const flowElements = useMemo(() => {
    if (!graph) return { nodes: [] as Node[], edges: [] as Edge[] }

    const flowNodes: Node[] = graph.nodes.map((n) => ({
      id: n.id,
      position: { x: 0, y: 0 },
      data: { label: n.attributes.filePath.split('/').pop() ?? n.id, fullPath: n.attributes.filePath },
    }))

    const flowEdges: Edge[] = graph.edges.map((e) => ({
      id: `${e.source}->${e.target}->${e.attributes.importLine}`,
      source: e.source,
      target: e.target,
      type: 'step',
      label: e.attributes.specifier,
      data: { line: e.attributes.importLine, kind: e.attributes.kind },
    }))

    return { nodes: flowNodes, edges: flowEdges }
  }, [graph])

  useEffect(() => {
    setNodes(flowElements.nodes)
    setEdges(flowElements.edges)
  }, [flowElements])

  const onNodesChange = useCallback((changes: any[]) => setNodes((ns) => applyNodeChanges(changes, ns)), [])
  const onEdgesChange = useCallback((changes: any[]) => setEdges((es) => applyEdgeChanges(changes, es)), [])
  const onConnect = useCallback((params: any) => setEdges((es) => addEdge(params, es)), [])

  if (!graph) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400">
        No graph loaded. Click <strong>Analyze Repository</strong> on a GitHub repo page.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full border border-gray-200 rounded-lg bg-white">
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(event, node) => {
            setSelectedNode(node.id)
            onNodeSelect(node.id)
          }}
          onPaneClick={() => {
            setSelectedNode(null)
            onNodeSelect(null)
          }}
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
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      <NodeInspector nodeId={selectedNode} graph={graph} />
    </div>
  )
}
