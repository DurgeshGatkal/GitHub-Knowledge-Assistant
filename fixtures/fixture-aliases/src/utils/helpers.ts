// fixture-aliases/src/utils/helpers.ts
//
// This file is the TARGET of the alias import '@/utils/helpers' in index.ts.
// The TypeScript compiler resolves '@/utils/helpers' → 'src/utils/helpers.ts'
// using the tsconfig.json paths mapping: "@/*" → ["src/*"]

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function uppercase(s: string): string {
  return s.toUpperCase();
}
