/**
 * index.ts — Public entry point for @repo/analyzer
 *
 * Re-exports every module a consumer (CLI, API server, eval scripts) needs,
 * plus all public types. This turns the analyzer package into a reusable
 * library instead of a folder of scripts.
 */

export { analyzeLocal, analyzeRemote } from './pipeline.js';
export { analyzeImpact } from './impact/index.js';

// Graph analysis primitives
export type { GraphAnalysis } from './graph/types.js';
export type {
  NodeAttributes,
  EdgeAttributes,
  UnresolvedImport,
} from './graph/types.js';

// Impact analysis primitives
export type { ImpactAnalysis } from './impact/types.js';
export type {
  AffectedFile,
  EvidenceLink,
  TestMatch,
  ImpactStats,
  AnalyzeImpactOptions,
  FindingStatus,
} from './impact/types.js';

// Reverse-traversal primitives (exposed for direct reuse / advanced callers)
export {
  reverseTraverse,
  buildReverseAdjacency,
  DEFAULT_DEPTH_LIMIT,
} from './impact/reverseSearch.js';
export { classifyFindings } from './impact/classifyFindings.js';
export { matchTests, isTestFile } from './impact/testMatching.js';

// GitHub URL parsing and ref resolution (website / API integration)
export {
  parseGithubUrl,
  resolveRef,
  fetchPRMetadata,
  fetchPRChangedFiles,
  type ParsedGithubUrl,
  type ParsedRepoUrl,
  type ParsedPullUrl,
  type ParsedCommitUrl,
  type UrlError,
  type UrlErrorCode,
  type ParseResult,
  type PRMetadata,
  type PRChangedFile,
  type PRFileStatus,
  type PRFetchDeps,
  type RefResolverDeps,
  type ResolveRefResult,
  type RefError,
  type RefErrorCode,
  type ResolveRefResultOrError,
} from './github/index.js';
