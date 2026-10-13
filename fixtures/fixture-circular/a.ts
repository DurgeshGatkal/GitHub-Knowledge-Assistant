// fixture-circular/a.ts
//
// CIRCULAR IMPORT — Part 1 of a 2-node cycle:  a.ts → b.ts → a.ts
//
// This is extremely common in real TypeScript codebases (e.g. React components that
// re-export each other, or utility modules with shared types). The graph builder MUST
// handle this without falling into an infinite loop.
//
// How the graph builder handles it:
//   - Uses a "visited" Set during any BFS/DFS traversal
//   - graphology itself can hold the edge A→B and B→A without crashing —
//     the cycle-safety requirement only applies to traversal, not to graph storage.

import { valueFromB } from './b.js';

export const valueFromA = 'value-a';
export const combined = `${valueFromA}-${valueFromB}`;
