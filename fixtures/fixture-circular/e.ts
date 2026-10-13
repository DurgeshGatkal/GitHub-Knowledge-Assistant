// fixture-circular/e.ts
//
// CIRCULAR IMPORT — Part 3 of 3-node cycle:  c.ts → d.ts → e.ts → c.ts
//
// e.ts closes the cycle back to c.ts, completing the 3-node loop.

import { valueFromC } from './c.js';

export const valueFromE = 'value-e';
export const chainE = `${valueFromE}+${valueFromC}`;

