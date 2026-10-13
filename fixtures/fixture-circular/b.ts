// fixture-circular/b.ts
//
// CIRCULAR IMPORT — Part 2 of a 2-node cycle:  a.ts → b.ts → a.ts
//
// b.ts imports from a.ts, which imports from b.ts — a direct circular dependency.
// TypeScript (and Node.js) resolve circular imports at runtime by returning the
// partially-constructed module, but for our dependency graph we simply record
// the edge b→a. graphology can store both a→b and b→a as directed edges.

import { valueFromA } from './a.js';

export const valueFromB = 'value-b';
export const derivedFromA = `derived-${valueFromA}`;
