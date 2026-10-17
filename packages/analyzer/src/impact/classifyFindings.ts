/**
 * classifyFindings.ts — Day 8 of the plan
 *
 * Turns the raw reverse traversal (Day 7) into LABELLED findings, per the
 * project plan Step 10:
 *
 *   confirmed  — reached by resolved import edges (a real path exists).
 *   unverified — (a) only reachable beyond the depth limit, or
 *                (b) an unresolved import link in a relevant file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY the depth limit produces Unverified, not Confirmed
 * ─────────────────────────────────────────────────────────────────────────────
 * The plan's quality rule: never present uncertain findings as confirmed. A
 * file one hop beyond the limit is affected — we simply did not verify how far
 * the impact spreads. Labelling it Unverified tells the truth: "searched only
 * to depth N".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why unresolved links appear as separate findings
 * ─────────────────────────────────────────────────────────────────────────────
 * An unresolved import has no target file, so the reverse search cannot follow
 * it. But it is still a hole in the picture: if a relevant file imports
 * something we could not resolve, the user must know. The plan's own example is
 * "require(someVariable) in loader.ts" → Unverified. We surface such links only
 * when the file containing them is part of the impact (changed or affected);
 * links in unrelated files would be noise.
 */

import type { UnresolvedImport } from '../graph/types.js';
import type {
  AffectedFile,
  FindingStatus,
  ReverseTraversal,
  TraversedFile,
  UnresolvedLink,
} from './types.js';

export interface ClassifyInput {
  /** Raw traversal from Day 7 (reverseSearch.ts) */
  traversal: ReverseTraversal;
  /** The graph's unresolved imports (from the graph builder / resolver) */
  unresolvedImports: UnresolvedImport[];
}

export interface ClassifiedFindings {
  /** One labelled finding per affected file, sorted by path */
  affectedFiles: AffectedFile[];
  /** Unresolved links found in relevant files, sorted */
  unresolvedLinks: UnresolvedLink[];
  /** Counts used to assemble the final ImpactStats */
  counts: {
    confirmed: number;
    unverifiedFiles: number;
    unresolvedLinks: number;
    beyondDepth: number;
  };
}

export function classifyFindings(input: ClassifyInput): ClassifiedFindings {
  const { traversal, unresolvedImports } = input;

  // Files reached within the limit are confirmed; files beyond it are
  // unverified. Depth-0 entries are the changed seeds and are never reported.
  const affectedFiles: AffectedFile[] = [
    ...traversal.visited
      .filter((node) => node.depth >= 1)
      .map((node) => toAffectedFile(node, 'confirmed')),
    ...traversal.beyond.map((node) => toAffectedFile(node, 'unverified')),
  ].sort((a, b) => a.file.localeCompare(b.file));

  const relevantFiles = new Set<string>([
    ...traversal.changedFiles,
    ...affectedFiles.map((finding) => finding.file),
  ]);

  const unresolvedLinks: UnresolvedLink[] = unresolvedImports
    .filter((link) => relevantFiles.has(link.sourceFile))
    .map((link) => ({
      sourceFile: link.sourceFile,
      specifier: link.specifier,
      importLine: link.importLine,
      kind: link.kind,
    }))
    .sort(
      (a, b) =>
        a.sourceFile.localeCompare(b.sourceFile) || a.importLine - b.importLine
    );

  return {
    affectedFiles,
    unresolvedLinks,
    counts: {
      confirmed: affectedFiles.filter((f) => f.status === 'confirmed').length,
      unverifiedFiles: affectedFiles.filter((f) => f.status === 'unverified')
        .length,
      unresolvedLinks: unresolvedLinks.length,
      beyondDepth: traversal.beyond.length,
    },
  };
}

function toAffectedFile(
  node: TraversedFile,
  status: FindingStatus
): AffectedFile {
  return {
    file: node.file,
    depth: node.depth,
    status,
    viaChangedFiles: [...node.viaChangedFiles].sort(),
    chain: node.chain,
  };
}
