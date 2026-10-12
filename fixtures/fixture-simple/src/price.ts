// fixture-simple: price module
// Tests: reexport, require(), and dynamic import()

export { formatCurrency } from './formatter';                   // re-export

const config = require('./config');                             // CommonJS require

export async function loadDiscount() {
  const discount = await import('./discount');                  // dynamic import
  return discount.default;
}

export function calculatePrice(base: number): number {
  return base * (1 - (config.discount ?? 0));
}
