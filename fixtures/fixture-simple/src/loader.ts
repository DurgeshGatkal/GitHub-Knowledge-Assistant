// fixture-simple: contains an import the resolver cannot resolve.
// Used to verify that unresolved links are surfaced as Unverified findings.
export async function loadMissing() {
  return import('./missing-module');
}
