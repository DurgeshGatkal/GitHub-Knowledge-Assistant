/**
 * testMatching.ts — Day 8 of the plan
 *
 * Suggests relevant tests, using the two rules from the project plan Step 9:
 *
 *   1. Import-based (confirmed) — a test file that is itself in the affected
 *      set. It imports affected code through resolved import edges, so the
 *      reverse search already reached it. These tests exercise the affected
 *      code.
 *
 *      Wording rule (plan Step 9): a test that imports affected code is
 *      evidence that it exercises that code — it does NOT prove the test covers
 *      the changed lines. The reason strings below therefore say "imports
 *      affected code", never "covers".
 *
 *   2. Name proximity (inferred) — a test file sitting beside a CHANGED file
 *      with a matching name (price.ts → price.test.ts). This is a heuristic
 *      with no import edge, which is exactly the plan's definition of
 *      "inferred".
 *
 * A test can match both rules. The two entries are merged; the stronger status
 * wins (confirmed > unverified > inferred).
 */

import type { GraphAnalysis } from '../graph/types.js';
import type {
  AffectedFile,
  FindingStatus,
  TestMatch,
  TestMatchRule,
} from './types.js';

/** Test-file naming conventions from the plan: *.test.*, *.spec.*, __tests__/ */
const TEST_FILE_RE = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Source extensions tried when guessing the name of a sibling test file. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Higher number = stronger evidence, used when merging two matches. */
const STATUS_PRIORITY: Record<FindingStatus, number> = {
  confirmed: 3,
  unverified: 2,
  inferred: 1,
};

/** True for a path that uses the project's test-file naming conventions. */
export function isTestFile(filePath: string): boolean {
  return TEST_FILE_RE.test(filePath);
}

export interface TestMatchingInput {
  /** The graph's nodes (used to check that a guessed sibling test exists) */
  nodes: GraphAnalysis['nodes'];
  /** The changed files (name-proximity looks beside these) */
  changedFiles: string[];
  /** The labelled affected files (import-based matches come from these) */
  affectedFiles: AffectedFile[];
}

export function matchTests(input: TestMatchingInput): TestMatch[] {
  const { nodes, changedFiles, affectedFiles } = input;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const matches = new Map<string, TestMatch>();

  // ── Rule 1: tests that import affected code ────────────────────────────────
  for (const affected of affectedFiles) {
    if (!isTestFile(affected.file)) continue;
    const existing = matches.get(affected.file);
    const entry: TestMatch = existing ?? {
      testFile: affected.file,
      status: affected.status,
      rules: [],
      reason: '',
      viaChangedFiles: [],
    };
    entry.status = strongest(entry.status, affected.status);
    addRule(entry, 'imports-affected-code');
    entry.reason = entry.reason
      ? entry.reason
      : 'imports affected code through resolved import edges';
    entry.viaChangedFiles = union(
      entry.viaChangedFiles,
      affected.viaChangedFiles
    );
    matches.set(affected.file, entry);
  }

  // ── Rule 2: sibling test by name (inferred) ────────────────────────────────
  for (const changed of changedFiles) {
    for (const candidate of siblingTestCandidates(changed)) {
      if (!nodeIds.has(candidate)) continue;

      const existing = matches.get(candidate);
      if (existing) {
        addRule(existing, 'name-proximity');
        existing.reason += `; sits beside changed file ${changed}`;
        existing.viaChangedFiles = union(existing.viaChangedFiles, [changed]);
        continue;
      }

      matches.set(candidate, {
        testFile: candidate,
        status: 'inferred',
        rules: ['name-proximity'],
        reason: `sits beside changed file ${changed}`,
        viaChangedFiles: [changed],
      });
    }
  }

  return [...matches.values()]
    .map((match) => ({
      ...match,
      viaChangedFiles: [...match.viaChangedFiles].sort(),
    }))
    .sort((a, b) => a.testFile.localeCompare(b.testFile));
}

/**
 * Guesses the sibling test paths for a changed file:
 *   src/price.ts → src/price.test.ts, src/price.spec.ts, and the same with
 *   every other source extension.
 */
function siblingTestCandidates(changed: string): string[] {
  const slash = changed.lastIndexOf('/');
  const dir = slash === -1 ? '' : changed.slice(0, slash + 1);
  const base = changed.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = dot === -1 ? base : base.slice(0, dot);

  const candidates: string[] = [];
  for (const ext of SOURCE_EXTENSIONS) {
    candidates.push(`${dir}${stem}.test${ext}`, `${dir}${stem}.spec${ext}`);
  }
  return candidates;
}

function addRule(match: TestMatch, rule: TestMatchRule): void {
  if (!match.rules.includes(rule)) match.rules.push(rule);
}

function union(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const value of b) if (!out.includes(value)) out.push(value);
  return out;
}

function strongest(a: FindingStatus, b: FindingStatus): FindingStatus {
  return STATUS_PRIORITY[a] >= STATUS_PRIORITY[b] ? a : b;
}
