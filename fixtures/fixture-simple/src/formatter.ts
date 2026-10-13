// fixture-simple: formatter module
// Target of: export { formatCurrency } from './formatter' in price.ts

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}
