/**
 * index.ts — Public exports for the github module.
 */

export {
  parseGithubUrl,
  type ParsedGithubUrl,
  type ParsedRepoUrl,
  type ParsedPullUrl,
  type ParsedCommitUrl,
  type UrlError,
  type UrlErrorCode,
  type ParseResult,
} from './parseGithubUrl.js';

export {
  resolveRef,
  type RefResolverDeps,
  type ResolveRefResult,
  type RefError,
  type RefErrorCode,
  type ResolveRefResultOrError,
} from './resolveRef.js';
