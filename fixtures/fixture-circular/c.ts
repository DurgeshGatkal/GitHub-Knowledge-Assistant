// fixture-circular/c.ts
//
// CIRCULAR IMPORT — Part 1 of a 3-node cycle:  c.ts → d.ts → e.ts → c.ts
//
// A longer cycle that would cause a naive DFS to loop forever without a visited set.

import { valueFromD } from './d.js';

export const valueFromC = 'value-c';
export const chainC = `${valueFromC}+${valueFromD}`;

