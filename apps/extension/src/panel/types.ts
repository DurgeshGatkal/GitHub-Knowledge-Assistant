/**
 * panel/types.ts — Shared types for the side-panel UI.
 */

export interface GraphAnalysis {
  owner: string
  repo: string
  sha: string
  nodes: Array<{ id: string; attributes: { filePath: string; sizeBytes: number } }>
  edges: Array<{
    source: string
    target: string
    attributes: {
      from: string
      to: string
      importLine: number
      specifier: string
      kind: string
      resolutionMethod: string
    }
  }>
  unresolvedImports: Array<{
    sourceFile: string
    specifier: string
    importLine: number
    kind: string
  }>
  stats: {
    totalFiles: number
    totalEdges: number
    unresolvedCount: number
    externalImportsSkipped: number
    parseErrors: number
  }
}

export interface PanelState {
  status: 'idle' | 'analyzing' | 'done' | 'error'
  owner?: string
  repo?: string
  sha?: string
  jobId?: string
  graph?: GraphAnalysis
  error?: string
}
