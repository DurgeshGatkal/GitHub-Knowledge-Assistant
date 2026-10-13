// fixture-aliases/src/index.ts
//
// Tests THREE resolution scenarios in one file:
//
//   1. Alias import:   '@/utils/helpers'
//      → tsconfig paths maps @/* to src/*, so this resolves to src/utils/helpers.ts
//
//   2. Barrel import:  './utils'
//      → no src/utils.ts, but src/utils/index.ts exists — TS resolver picks up barrel
//
//   3. .js extension import: './api.js'
//      → Node16 moduleResolution requires .js extensions for ESM, but the real file is api.ts
//      → TS resolver maps .js → .ts (one of the trickiest resolution rules)

import { greet } from '@/utils/helpers';           // alias resolution
import { everything } from './utils';               // barrel file resolution
import { fetchData } from './api.js';               // .js → .ts mapping

console.log(greet('World'), everything, fetchData());
