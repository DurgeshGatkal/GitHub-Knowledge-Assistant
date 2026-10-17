// fixture-simple: test file that imports affected code.
// Used to verify the import-based test-matching rule (Confirmed):
// it imports './index', which is the affected file when price.ts changes.
import { calculatePrice } from './index';

export function testCalculatePrice(): number {
  return calculatePrice(100);
}
