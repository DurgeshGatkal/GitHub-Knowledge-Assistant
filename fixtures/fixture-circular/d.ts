// fixture-circular/d.ts
//
// CIRCULAR IMPORT — Part 2 of 3-node cycle:  c.ts → d.ts → e.ts → c.ts

import { valueFromE } from './e.js';

export const valueFromD = 'value-d';
export const chainD = `${valueFromD}+${valueFromE}`;
