// fixture-aliases/src/utils/index.ts
//
// This is a BARREL FILE — it re-exports everything from helpers.ts.
//
// When index.ts does `import { everything } from './utils'`, the TS resolver
// first looks for src/utils.ts (doesn't exist), then tries src/utils/index.ts
// (this file). This "index file fallback" is a core barrel-file resolution rule.

export * from './helpers';

export const everything = 'all exports from utils';
