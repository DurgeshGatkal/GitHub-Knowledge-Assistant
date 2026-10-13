// fixture-aliases/src/api.ts
//
// This file is imported in index.ts as './api.js' (with .js extension).
//
// In TypeScript's Node16/NodeNext module resolution, ESM imports MUST include
// explicit file extensions. However, the actual file on disk is `.ts`, not `.js`.
// The TS resolver knows the rule: when it sees './api.js', it looks for './api.ts'.
// This .js → .ts remapping is one of the trickiest patterns to get right in a
// custom resolver.

export async function fetchData(): Promise<string> {
  return 'data from api';
}
