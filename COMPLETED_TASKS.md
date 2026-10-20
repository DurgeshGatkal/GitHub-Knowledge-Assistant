# Completed Tasks — Step-by-Step Implementation Record

> **Project:** GitHub Knowledge Assistant (Evidence-backed Repository Exploration & PR Change-Impact Analysis)
> **Scope of this document:** every task completed from **Day 1 to Day 12**, with each sub-part, *what* was done and *why*.
> **Status:** the static-analysis engine (`packages/analyzer`), the Fastify API (`apps/api`), and the website (`apps/web`) are complete through **Day 12**. Tests: analyzer **93/93**, API **16/16**. Days 13–14 (LLM explanation, Docker, deploy) are **pending**.
> **Last updated:** 2026-10-20

---

## How to read this document

- The project is built in 2-day "day blocks" (Day 1–3, Day 4–6, Day 7–8, …), exactly as defined in the master plan (`GitHub_Repository_Intelligence_Extension_Project_Plan.md`, Section 8 "Build order").
- Each day block contains several **tasks**. Each task is described with:
  - **File(s)** it lives in.
  - **What it does** (the purpose).
  - **How it does it** (the mechanism / algorithm).
  - **Why this way** (the design reasoning, where non-obvious).
- Pipeline mapping to the plan's 12 steps is shown so the "which step is this?" question always has an answer.

### The 12-step pipeline and what is done so far

| Pipeline step | Built in | Status |
| --- | --- | --- |
| Step 1 — Detect where the user is | Day 10 (website landing) | ✅ done |
| Step 2 — Send a request, track it as a job | Day 10 (API jobs + polling) | ✅ done |
| Step 3 — Download the exact version and filter files | **Days 1–3** | ✅ done |
| Step 4 — Parse each file into a tree (AST) | **Days 1–3** | ✅ done |
| Step 5 — Resolve imports to real files | **Days 4–6** | ✅ done |
| Step 6 — Build the dependency graph | **Days 4–6** | ✅ done |
| Step 7 — Show the graph (Analyze Repository) | Day 10 (website graph) | ✅ done |
| Step 8 — Find what changed in the pull request | Day 11 (PR analysis API) | ✅ done |
| Step 9 — Compute the impact (reverse search) | **Days 7–8** | ✅ done |
| Step 10 — Label every finding | **Days 7–8** | ✅ done |
| Step 11 — Let the LLM explain, under strict rules | Days 13–14 | ⬜ pending |
| Step 12 — Show results in a side panel | Day 12 (website PR page) | ✅ done |

**In one line:** the analyzer engine, Fastify API, and website are complete through Day 12 (repo + PR results). Days 13–14 (LLM explanation, Docker, deploy, README) remain.

### Git history (day markers)

```
0c64961  feat: initial commit - core analyzer engine ... (Days 1-3)
bf22c3c  Days 4-6: Import resolution and dependency graph construction
facfa1f  Days 7-8: add shared types for impact analysis
9f6e43e  Days 7-8: implement Day 7 reverse dependency search
7159217  Days 7-8: implement Day 8 finding classification
8cec41f  Days 7-8: implement Day 8 test matching
2d0b10e  Days 7-8: add analyzeImpact orchestrator
0c8a105  Days 7-8: add fixture-simple files for impact tests
bb2d390  Days 7-8: add 14 impact-analysis tests
d5954ae  Days 7-8: add analyzeImpact CLI
4851f0f  Days 7-8: add root vitest config
6edf7f9  docs: update README for Days 7-8
7da0c47  Pivot Day 9: parseGithubUrl.ts, resolveRef.ts, extractor limits
085f042  Pivot Day 9: /api/analyze accepts { url }
c1cfd9d  Pivot Day 9: /api prefix fix, CORS multi-origin fix
e9bd6e1  Pivot Day 9: API route prefix fix
f7b9cfa  Pivot Day 9: CORS multi-origin fix
17b4d17  Graphology runtime fix (createRequire dynamic import)
c4ba348  Pivot Day 11: pr.ts PR metadata/changed files + prAnalysisJob
0cabcf2  Day 12: PR results page on website
13465d9  Fix: API client calls API server directly (double /api fix)
ea1eb24  Fix: double /api, parallel-edge crash, branch ref resolution
de07783  Repo graph: layered layout, labelled edges, node details panel
e0ae8f4  Route PR jobs to PR results page, reuse finished result
c445690  Day 12 finish: go-to-line links, collapsible evidence, read-only note
```

---

# DAY 1–3 — Core Extraction Engine

**Goal (from the plan):** *"A command prints every import with its line number for a real repository."*

This block builds the front half of the pipeline: download a repository, keep only real source files, and read every import from them with exact line numbers.

---

## Task 1.1 — GitHub Tarball Streaming Fetcher

**File:** `packages/analyzer/src/fetcher/fetcher.ts`
**Pipeline step:** Step 3 (download the exact version)

### What it does
Downloads a whole GitHub repository at one exact commit SHA as a single `.tar.gz` stream, and saves it to a temp file on disk.

### How it does it
- Builds the URL `https://api.github.com/repos/{owner}/{repo}/tarball/{sha}` — GitHub's tarball endpoint, which redirects to the real archive.
- Sends request headers: `Accept: application/vnd.github+json`, a `User-Agent`, `X-GitHub-Api-Version: 2022-11-28`, and an optional `Authorization: Bearer <token>` (raises the rate limit from 60 → 5000 requests/hour).
- Follows the 302 redirect with `redirect: 'follow'`.
- **Streams** the response body straight to disk using `stream/promises.pipeline(response.body, createWriteStream(...))` — the archive is never fully loaded into memory, so large repos don't blow up RAM.
- Returns `{ tarballPath, tempDir }` so the caller can clean up afterwards.

### Why this way
- **One request instead of hundreds.** The naive approach is the GitHub "contents" API, one call per file — which is slow and eats the rate limit. A tarball is one atomic snapshot.
- **SHA, not `main`.** Downloading a branch name would give a different result every time. A SHA is deterministic and therefore *cacheable* (needed for the `(repo, sha)` cache in Days 9–10).
- The repo code is **never executed** — only downloaded and read.

---

## Task 1.2 — Tarball Extractor (with filtering pass)

**File:** `packages/analyzer/src/fetcher/extractor.ts`
**Pipeline step:** Step 3 (extract & filter)

### What it does
Unpacks the `.tar.gz` into a local directory, but **only writes the files we care about** (the rest are skipped, saving time and disk).

### How it does it
- **Pass 1 (`tar.t`):** walk the archive entries *without* extracting. For every entry that is a regular file (`entry.type === 'File'`):
  - strip GitHub's top-level wrapper folder (e.g. `owner-repo-abc123/src/index.ts` → `src/index.ts`) via `stripTopLevelDir()`;
  - ask `shouldAnalyzeFile(relativePath, sizeBytes)` whether it is worth keeping;
  - if yes, record a `FileEntry`; if no, increment `skippedCount`.
- **Pass 2 (`tar.x`):** extract with a `filter` that only allows the recorded relative paths, and `strip: 1` to drop the top-level folder automatically.
- Returns `{ extractDir, files, totalFilesFound, skippedCount }`.

### Why this way
- Filtering *before* writing avoids extracting thousands of useless files.
- Stripping the top-level folder means every path is **relative to the repo root** (`src/index.ts`), which is the identifier scheme used everywhere else (graph nodes, edges, findings).

---

## Task 1.3 — High-Performance Source File Filter

**File:** `packages/analyzer/src/fetcher/fileFilter.ts`
**Pipeline step:** Step 3 (which files count)

### What it does
One pure function, `shouldAnalyzeFile(relativePath, sizeBytes)`, deciding whether a file is real analyzable source.

### How it does it (the 5 rules, in order)
1. **Size limit** — reject files larger than **2 MB** (`MAX_FILE_SIZE_BYTES`); huge files are almost always generated/minified.
2. **Directory exclusion** — if any path segment is in `SKIPPED_DIRS` (`node_modules`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.cache`, `coverage`, `__pycache__`, `.git`), reject.
3. **Filename patterns** — reject `*.min.js`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `*.d.ts`, `*.map`.
4. **Extension whitelist** — keep only `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`.
5. Anything else → reject.

### Why this way
- This is the plan's Step 3 exactly. Keeping it a **pure, dependency-free function** makes it trivially unit-testable (18 tests, no filesystem needed) and reusable by both the tarball path (`extractor.ts`) and the local path (`pipeline.ts`).

---

## Task 1.4 — Tree-sitter WASM AST Parser & Import Extractor

**File:** `packages/analyzer/src/parser/parser.ts`
**Pipeline step:** Step 4 (parse into an AST)

### What it does
Parses each source file into a real syntax tree and extracts every import/require/re-export with a 1-based line number.

### How it does it
- **Parser init (`initParser`)** loads two WebAssembly grammars (`tree-sitter-javascript.wasm`, `tree-sitter-typescript.wasm`) from `grammars/`. Guarded by a singleton + a `wasmInitialised` flag, because calling `Parser.init()` twice throws.
- `getParser(filePath)` picks the TS parser for `.ts`/`.tsx` and the JS parser otherwise.
- `extractImports(filePath)`:
  - reads the file (returns `parseError: true` on failure instead of throwing);
  - parses it to a tree;
  - runs **four Tree-sitter S-expression queries**, one per import kind:
    | Query | Matches | Kind recorded |
    | --- | --- | --- |
    | `STATIC_IMPORT_QUERY` | `import x from './m'` | `static` |
    | `REEXPORT_QUERY` | `export * from './m'`, `export {x} from './m'` | `reexport` |
    | `DYNAMIC_IMPORT_QUERY` | `import('./m')` | `dynamic` |
    | `REQUIRE_QUERY` | `require('./m')` | `require` |
  - each match yields a `{ specifier, line, kind }` record (`line = node.startPosition.row + 1`);
  - results are sorted by line number.

### Why this way
- **Tree-sitter, not regex.** Regex is fooled by the word "import" inside comments or template strings. Tree-sitter builds a *real* AST, so extractions only ever come from actual code.
- **WASM build (`web-tree-sitter`)**, not the native C++ binding, because native Tree-sitter needs `node-gyp` and breaks constantly on Windows. WASM works identically on Windows/Linux/macOS with zero compilation.
- **Never throws** — one unparseable file becomes a `parseError` flag instead of crashing the whole run.

### Supporting task 1.4b — Grammar downloader
**File:** `packages/analyzer/scripts/download-grammars.mjs`
Downloads the two pre-built `.wasm` grammars from the `unpkg` CDN (`tree-sitter-wasms@0.1.12`) into `packages/analyzer/grammars/`, skipping any that already exist. Uses Node 18+ native `fetch` and streams to disk.

---

## Task 1.5 — Days 1–3 Verification CLI

**File:** `packages/analyzer/src/cli/extractImports.ts`

### What it does
A 4-stage command that proves the day's success condition end-to-end against a *real* GitHub repo:
```
[1/4] Fetching repository tarball from GitHub...      (fetcher)
[2/4] Extracting and filtering source files...        (extractor + fileFilter)
[3/4] Initialising Tree-sitter parsers (WASM)...      (parser)
[4/4] Extracting imports with line numbers:           (parser)
```
It prints a table (`FILE | LINE | KIND | SPECIFIER`), a summary (files analyzed, parse errors, imports found), and `Status: SUCCESS (Days 1-3 criteria verified)`, then cleans up its temp directories.

### How to run
```bash
npx tsx packages/analyzer/src/cli/extractImports.ts <owner> <repo> <sha> [github-token]
```

### Why this way
The plan insists the engine be verifiable **from the command line before any UI exists**. A CLI makes "does it work on a real repo?" answerable without a browser.

---

## Task 1.6 — Test: File Filter

**File:** `packages/analyzer/test/fileFilter.test.ts` — **18 tests**
Covers every rule: keeps 6 extensions; skips `node_modules`, `dist/`, `build/`, nested `node_modules`, `*.min.js`, `*.d.ts`, `*.map`, `package-lock.json`, `yarn.lock`, oversized files, extensionless files, and `.json`.

## Task 1.7 — Test: Parser

**File:** `packages/analyzer/test/parser.test.ts` — **6 tests**
Run against `fixtures/fixture-simple/src/index.ts` (static imports, exact line numbers, no false `require`/dynamic) and `price.ts` (re-export, `require()`, dynamic `import()`), including "all line numbers ≥ 1".

---

# DAY 4–6 — Import Resolution & Dependency Graph

**Goal (from the plan):** *"Results on 2–3 repositories match what you check by hand."*

This block turns raw import *strings* into *edges between real files*, then assembles them into the dependency graph — the data structure everything after this depends on.

---

## Task 2.1 — TypeScript Import Resolver

**File:** `packages/analyzer/src/resolver/resolver.ts`
**Pipeline step:** Step 5 (resolve imports to real files)

### What it does
Turns a raw specifier (`./price`, `@/utils/helpers`, `./utils`, `./api.js`, `react`) into the real file path it points to, and records **how** it was resolved.

### How it does it
- **`loadCompilerOptions(repoRoot)`** — reads the repo's `tsconfig.json` with `ts.readConfigFile` + `ts.parseJsonConfigFileContent`. Falls back to `Node16` resolution defaults if the file is missing or malformed.
- **`makeHost(repoRoot)`** — a minimal TypeScript `ModuleResolutionHost` whose `fileExists` / `readFile` / `directoryExists` read from the **extracted repo directory**, not the process CWD.
- **`resolveFileImports(...)`** — for every parser record:
  1. `isBarePackageSpecifier()` pre-classifies npm names (`react`, `lodash`, `@scope/pkg`) as **external**, *before* asking TypeScript. This matters because fixture repos have no `node_modules`, so TS would otherwise return `null` and we'd wrongly call `react` "unresolved". A regex (`NPM_PACKAGE_RE`) plus a tsconfig-alias check decides this, so invented strings like `__DOES_NOT_EXIST__` still count as unresolved.
  2. Otherwise calls `ts.resolveModuleName(specifier, sourceAbsPath, compilerOptions, host)` — TypeScript's *own* resolver.
  3. If it resolves, marks `isExternal` from `resolved.isExternalLibraryImport` and computes the repo-relative path.
  4. If it does **not** resolve, records `resolutionMethod: 'unresolved'` — **never dropped** (plan rule).
- **`classifyResolution(...)`** labels the method as `relative` / `alias` / `index` / `baseUrl` / `nodeModule`, by inspecting the specifier + resolved path.

### Why this way
- **Use TypeScript's resolver instead of hand-writing rules.** Five rules interact: relative paths, `paths` aliases, barrel `index` files, `.js → .ts` mapping, and `baseUrl`. TypeScript already implements all five correctly; re-implementing them by hand diverges from what real compilers do.
- The plan's hard rule — *"Unresolvable paths are recorded explicitly as Unverified, not silently dropped"* — is enforced right here.

---

## Task 2.2 — Graph Type Definitions

**File:** `packages/analyzer/src/graph/types.ts`

### What it does
Defines the exact data model of the graph (used by the builder, CLI, tests, and later the API + extension):

| Type | Purpose |
| --- | --- |
| `NodeAttributes` | One per file: `filePath`, `sizeBytes` |
| `EdgeAttributes` | One per import: `from`, `to`, `importLine`, `specifier`, `kind`, `resolutionMethod` |
| `UnresolvedImport` | `sourceFile`, `specifier`, `importLine`, `kind` — feeds the UI's "unverified links" count |
| `GraphAnalysis` | The whole result: `owner`, `repo`, `sha`, `nodes[]`, `edges[]`, `unresolvedImports[]`, `stats` |
| `stats` | `totalFiles`, `totalEdges`, `unresolvedCount`, `externalImportsSkipped`, `parseErrors` |

### Why this way
- Types live in a **separate file** so the builder, CLI, tests and (later) API all import from one place — no circular imports, one source of truth.
- The result is deliberately **plain JSON arrays**, not a graphology object, so it can be `JSON.stringify`-ed and shipped over HTTP to the extension.

---

## Task 2.3 — graphology Dependency Graph Builder

**File:** `packages/analyzer/src/graph/graphBuilder.ts`
**Pipeline step:** Step 6 (build the graph)

### What it does
`buildGraph(input)` consumes every file + its resolved imports and produces the final `GraphAnalysis`.

### How it does it
- **Pass 1 — nodes:** add one graphology node per successfully-parsed file (key = relative path). Files with no imports are still added (they can be leaves the UI should show).
- **Pass 2 — edges:** for each resolved import:
  - **external** → counted in `externalImportsSkipped` and skipped (no `react` nodes!);
  - **unresolved** → pushed into `unresolvedImports[]` (Unverified);
  - **resolved** → add a directed edge `source → target` meaning *"source imports target"*. A **deterministic edge key** `source::target::line` makes repeated builds idempotent and allows a file to import another file more than once.
- **Serialise:** convert the graphology instance to plain `nodes[]` / `edges[]` arrays and compute `stats`.

### Why this way
- **graphology** is the JS equivalent of NetworkX: typed attributes, multi-edges, fast adjacency lookups (needed for the Days 7–8 reverse BFS), and it does **not** crash on cycles. Cycle *safety* is a traversal concern, handled later with a visited set.
- Edge direction is fixed as **importer → imported**, which is the opposite direction the impact search will walk (it goes backwards: "who imports me?").

---

## Task 2.4 — Analysis Pipeline Orchestrator

**File:** `packages/analyzer/src/pipeline.ts`

### What it does
Wires all stages into one function call, in **two modes**:

- **`analyzeRemote({ owner, repo, sha, githubToken })`** — fetch tarball → extract+filter → parse → resolve → build graph. Cleans up temp dirs in a `finally` block.
- **`analyzeLocal({ repoPath })`** — walks a local directory (`walkDir` + `shouldAnalyzeFile`), then runs the *same* core logic.
- **`_runCoreAnalysis(...)`** (private) — the shared stages 3–5: `initParser()`, `loadCompilerOptions(repoRoot)` *once*, then per file `extractImports()` → `resolveFileImports()`, and finally `buildGraph()`.

### Why this way
- The plan's verification for Days 4–6 requires checking results **by hand** on 2–3 repos. Doing that against GitHub in tests would be slow, token-dependent and non-deterministic — so **local mode** lets tests and the CLI work fully offline against fixtures.
- Each stage stays a pure module (testable in isolation); the pipeline just connects them, and it's the single entry point the future API job will call.

---

## Task 2.5 — Days 4–6 Verification CLI

**File:** `packages/analyzer/src/cli/buildGraph.ts`

### What it does
Prints the built graph as human-readable tables so edges can be checked by eye:
- **NODES** (`FILE | SIZE`);
- **EDGES** (`FROM → TO | LINE | KIND | METHOD`);
- **UNRESOLVED IMPORTS** (or "none");
- a **summary** (files, edges, unresolved, external skipped, parse errors) and `Status: SUCCESS (Days 4–6 criteria verified)`.

Two modes:
```bash
npx tsx packages/analyzer/src/cli/buildGraph.ts <owner> <repo> <sha> [token]   # remote
npx tsx packages/analyzer/src/cli/buildGraph.ts --local <path-to-repo>          # local
```

---

## Task 2.6 — Test Fixtures (deterministic mini-repos)

**Location:** `fixtures/`

| Fixture | Files | What it proves |
| --- | --- | --- |
| `fixture-simple/` | `src/index.ts`, `price.ts`, `types.ts`, `formatter.ts`, `config.ts`, `discount.ts`, `utils/helpers.ts` | static imports, default+named imports, `import type`, re-export, `require()`, dynamic `import()`, external `react` |
| `fixture-aliases/` | `src/index.ts`, `src/utils/helpers.ts`, `src/utils/index.ts`, `src/api.ts`, `tsconfig.json` | three hard resolution cases at once: `paths` alias (`@/utils/helpers`), barrel (`./utils` → `utils/index.ts`), and `.js → .ts` (`./api.js` → `api.ts`) |
| `fixture-circular/` | `a.ts`,`b.ts` (2-cycle) and `c.ts`,`d.ts`,`e.ts` (3-cycle) | cycles are stored safely and never loop a traversal |

Each fixture has a `tsconfig.json` giving the resolver real compiler options (`Node16`, and `paths: { "@/*": ["src/*"] }` for the alias fixture).

---

## Task 2.7 — Tests: Resolver

**File:** `packages/analyzer/test/resolver.test.ts` — **11 tests**
`./price → src/price.ts`, `./types`, external `react` (`isExternal = true`), import line capture, re-export `./formatter`, `require('./config')`, dynamic `./discount`, alias `@/utils/helpers`, barrel `./utils → src/utils/index.ts`, `.js → .ts` (`./api.js → src/api.ts`), and "invalid specifier recorded as `unresolved`, not dropped".

## Task 2.8 — Tests: Graph Builder

**File:** `packages/analyzer/test/graphBuilder.test.ts` — **14 tests**
All fixture files become nodes; directed edges for static/re-export/require/dynamic imports; `react` is **not** a node; stats consistent; alias/barrel/`.js → .ts` edges in `fixture-aliases`; and `fixture-circular` builds without throwing, stores both edges of the 2-cycle and all three of the 3-cycle, with zero unresolved imports.

---

# DAY 7–8 — Impact Analysis & Finding Classification

**Goal (from the plan):** *"Given a file, you get the right affected list and tests."*

This block implements **Step 9 (reverse search)** and **Step 10 (labels, evidence chains, test matching)**: given the files a change touches, find everything that may be affected and *prove* each finding with the exact imports that lead to it.

**Location:** `packages/analyzer/src/impact/`

---

## Task 3.1 — Impact Type Definitions

**File:** `packages/analyzer/src/impact/types.ts`

### What it does
Defines the impact data model:

| Type | Meaning |
| --- | --- |
| `FindingStatus` | `'confirmed' \| 'inferred' \| 'unverified'` (the plan's three labels) |
| `EvidenceLink` | One step of a chain: `from`, `to`, `importLine`, `kind`, `specifier` |
| `AffectedFile` | A finding: `file`, `depth`, `status`, `viaChangedFiles`, `chain` |
| `UnresolvedLink` | An unresolved import in a *relevant* file (shown as Unverified) |
| `TestMatch` | `testFile`, `status`, `rules`, `reason`, `viaChangedFiles` |
| `ImpactStats` | `depthLimit`, `visitedCount`, `confirmedCount`, `inferredCount`, `unverifiedCount`, `beyondDepthCount`, `unresolvedLinkCount` |
| `ImpactAnalysis` | `changedFiles`, `affectedFiles`, `testMatches`, `unresolvedLinks`, `stats` |
| `ReverseTraversal` | Raw Day-7 output: `visited[]`, `beyond[]`, `visitedCount` |

### Where each label applies (the important design decision)
- **confirmed** — an affected file reached by following **resolved** import edges.
- **unverified** — a finding the analyzer could not decide: (a) an affected file only reachable **beyond the depth limit**, or (b) an **unresolved import link** in a relevant file.
- **inferred** — a heuristic with **no direct import edge**; in this phase it labels **test files matched by name proximity** (`price.test.ts` beside `price.ts`) — the plan's own example.

### Why this way
- The plan speaks of "affected files" and "findings" as if they were two things. They are the same thing — **one affected file is one finding** — so the implementation exposes a single `affectedFiles` array and the two views can never drift apart.
- `EvidenceLink` uses `from`/`to`, matching the graph builders `EdgeAttributes`, so a chain link is self-describing.

---

## Task 3.2 — Reverse Dependency Search (Day 7 core)

**File:** `packages/analyzer/src/impact/reverseSearch.ts`
**Pipeline step:** Step 9

### What it does
`reverseTraverse(analysis, { changedFiles, depthLimit? })` walks the graph **backwards** from the changed files and returns the raw traversal.

### How it does it
- **`buildReverseAdjacency(analysis)`** — flips the edges into a map `imported file → [links that import it]`, sorted for determinism.
- **Breadth-first search over the reverse adjacency:**
  1. Seed `visited` with every changed file at `depth 0` (each is its own `via` file).
  2. For each level up to `depthLimit` (default **3**), find the importers of the current frontier; skip anything already visited (**cycle guard** / shortest-path wins); record `depth`, `chain`, and `viaChangedFiles`.
  3. After the loop, files **exactly one hop beyond** the limit are collected into `beyond[]` (so Day 8 can label them Unverified instead of silently dropping them).
- **`propagateViaChangedFiles(...)`** — a second, ascending pass unions the `viaChangedFiles` lists, so a file reached from several changed files lists all of them (needed because a node is discovered once, through its shortest path).
- `visitedCount` = number of distinct files touched, including the seeds.

### Why this way
- An edge is `importer → imported`. If `price.ts` changes, the danger is in files that **import** it — the arrows pointing *in* — so the search follows incoming edges: *"who imports me? who imports them?"* (the plan's exact wording).
- The depth limit keeps the result useful (not the entire transitive closure). A `visited` set makes cycles (`a → b → a`) impossible to loop on.
- Changed files are **never** reported as affected (a file doesn't affect itself) — they are only seeds.

---

## Task 3.3 — Finding Classification (Day 8)

**File:** `packages/analyzer/src/impact/classifyFindings.ts`
**Pipeline step:** Step 10

### What it does
`classifyFindings({ traversal, unresolvedImports })` turns the raw traversal into **labelled findings**.

### How it does it
- Files reached within the limit → `AffectedFile` with status **`confirmed`**; files in `beyond[]` → status **`unverified`**. Sorted by path. (Depth-0 seeds are excluded — they're the changed files.)
- **Unresolved links** are surfaced as `UnresolvedLink[]` **only when the file containing them is relevant** — i.e. it is a changed file or an affected file. Links in unrelated files would just be noise.
- Returns counts (`confirmed`, `unverifiedFiles`, `unresolvedLinks`, `beyondDepth`) used to assemble the final stats.

### Why this way
- **The plan's quality rule:** never present uncertain findings as confirmed. A file one hop past the limit *is* affected — we simply didn't verify how far the impact spreads — so labelling it `unverified` tells the truth: *"searched only to depth N"*.
- An unresolved import has **no target**, so the reverse search can't follow it. Surfacing it separately as an Unverified *link* is how the plan's example (`require(someVariable)` in `loader.ts`) becomes visible without pretending to know where it goes.

---

## Task 3.4 — Test Matching (Day 8)

**File:** `packages/analyzer/src/impact/testMatching.ts`
**Pipeline step:** Step 9 (test selection)

### What it does
`matchTests({ nodes, changedFiles, affectedFiles })` suggests relevant tests using two rules.

### How it does it
- **Rule 1 — imports affected code (confirmed/unverified):** any affected file whose path looks like a test (`*.test.*`, `*.spec.*`, or inside `__tests__/`, via `TEST_FILE_RE`) is a match. It inherits the file's own status.
- **Rule 2 — name proximity (inferred):** for each **changed** file, guess sibling test names (`price.ts → price.test.ts`, `price.spec.ts`, and the same across source extensions) and keep the ones that actually exist as graph nodes.
- **Merging:** a test can match both rules. Entries are merged; `rules[]` is unioned; the **stronger status wins** (`confirmed > unverified > inferred`); `viaChangedFiles` is unioned and sorted.

### Why this way
- Rule 1 is *evidence* the test exercises affected code — it does **not** prove coverage of the changed lines, so the wording is always "imports affected code", never "covers".
- Rule 2 is a heuristic with no import edge — exactly the plan's definition of **inferred**.

---

## Task 3.5 — Public Orchestrator `analyzeImpact`

**File:** `packages/analyzer/src/impact/index.ts`

### What it does
`analyzeImpact(analysis, { changedFiles, depthLimit? })` chains the three stages and returns the final `ImpactAnalysis`:
1. `reverseTraverse` (Day 7)
2. `classifyFindings` (Day 8)
3. `matchTests` (Day 8)

…then assembles `ImpactStats` (confirmed, inferred from test matches, unverified = depth-limited files + unresolved links, beyond-depth, visited).

### Why this way
- It takes an **already-built `GraphAnalysis`** plus the changed-file list, so the pure analyzer **never needs GitHub PR APIs**. Deciding which files a PR changed (Step 8) is the extension/server's job — this keeps the engine deterministic and unit-testable.
- The module also re-exports the pieces (`reverseTraverse`, `buildReverseAdjacency`, `classifyFindings`, `matchTests`, `isTestFile`, `DEFAULT_DEPTH_LIMIT`, and all types) for direct reuse.

---

## Task 3.6 — Days 7–8 Verification CLI

**File:** `packages/analyzer/src/cli/analyzeImpact.ts`

### What it does
Prints the full impact report so it can be verified by eye against the sources:
- **AFFECTED FILES** table (`FILE | DEPTH | STATUS | VIA`);
- **EVIDENCE CHAINS** (indented, showing each import link with line/kind/specifier, ending at the affected file);
- **RELEVANT TESTS** (`TEST FILE | STATUS | RULES` + a "why" reason);
- **UNRESOLVED LINKS** (shown as Unverified);
- a **summary** and `Status: SUCCESS (Days 7–8 criteria verified)`.

Two modes:
```bash
npx tsx packages/analyzer/src/cli/analyzeImpact.ts --local <path> --changed <file1,file2> [--depth 3]
npx tsx packages/analyzer/src/cli/analyzeImpact.ts <owner> <repo> <sha> --changed <file1,file2> [--token <t>] [--depth 3]
```

---

## Task 3.7 — New Fixture Files for Impact Tests

**Location:** `fixtures/fixture-simple/src/`

| File | Purpose |
| --- | --- |
| `price.test.ts` | imports `./index` (affected code) → exercises the **import-based** match (**Confirmed**) |
| `config.test.ts` | sits beside `config.ts` but imports nothing relevant → exercises the **name-proximity** match (**Inferred**) |
| `loader.ts` | contains `import('./missing-module')` (unresolvable) → exercises the **Unresolved → Unverified** path |

These additions changed one earlier expectation: because `price.test.ts` imports `index.ts`, changing `price.ts` now yields **two** affected files (`index.ts` at depth 1, `price.test.ts` at depth 2) instead of one.

---

## Task 3.8 — Impact Analysis Tests

**File:** `packages/analyzer/test/impactAnalysis.test.ts` — **14 tests**, split into two groups.

**Day 7 — reverse traversal (8 tests):**
1. finds direct + transitive importers with depths and evidence chains;
2. never lists a changed file as affected;
3. follows alias and barrel edges back to the importer (`fixture-aliases`);
4. walks a cycle without looping and keeps the changed file out (`fixture-circular`);
5. marks files only reachable beyond the depth limit as **unverified** (`depthLimit: 1`);
6. exposes the raw traversal with seeds at depth 0;
7. is deterministic (same input → deep-equal result);
8. returns an empty report for an empty changed list.

**Day 8 — classification & test matching (6 tests):**
9. labels a test that imports affected code as **confirmed**;
10. suggests a sibling test by name as **inferred**;
11. merges the two rules when a test matches both;
12. surfaces unresolved links in relevant files as **unverified**;
13. merges evidence when several changed files reach the same file (`viaChangedFiles` union);
14. keeps the stats consistent with the findings.

The graphs are built with `analyzeLocal()` against the fixtures and cached per fixture, so every expectation is hand-checkable against the fixture sources.

---

## Task 3.9 — Root Vitest Configuration

**File:** `vitest.config.ts` (repository root)

### What it does
Scopes test discovery to `packages/*/test/**/*.test.ts`.

### Why this way
The new fixture files are *named* like tests (`price.test.ts`) **on purpose** — they exercise the test-matching rules — but they are not test suites. Without a root config, vitest's default glob picked them up from the repo root and failed with "No test suite found in file". This config keeps `npx vitest run` and `npm test` green from the root.
(The analyzer package keeps its own `packages/analyzer/vitest.config.ts` with the same include.)

---

## Task 3.10 — Documentation Update

**File:** `README.md`
- Heading updated to "Key Features Built So Far (Days 1–8)".
- Added feature sections **4. TypeScript Import Resolver**, **5. graphology Dependency Graph**, **6. Reverse Impact Analysis**.
- Testing section updated to 63/63 across 5 files.
- Added a **Live Change-Impact CLI** example.
- Roadmap: **Days 4–6** and **Days 7–8** now checked off.

**Plan document resolved issues** (`C:\Users\Durgesh\.opencode\plan\days-7-8-impact-analysis.md`, outside the repo): the earlier draft had a table that contradicted the intended depth-limit semantics and a duplicate findings array; both were corrected, and an "Implementation status (as built)" section was added.

---

# Design Decisions Recorded Along the Way

| ID | Decision | Reason |
| --- | --- | --- |
| D1 | The changed-file list is an **input** to the analyzer, not computed here. | PR-file detection (Step 8) is the extension/server's job; keeps the engine pure and testable. |
| D2 | Depth-limit-truncated findings are labelled **Unverified**. | Quality rule: never present uncertain findings as confirmed. |
| D3 | Impact is computed per changed file; a file reachable from several changed files gets **one merged finding** with all of them in `viaChangedFiles`. | Avoids duplicate findings. |
| D4 | `EvidenceLink` uses `from` / `to`, matching `EdgeAttributes`. | One consistent vocabulary across graph and impact layers. |
| D5 | `affectedFiles` **are** the findings (no separate `findings[]`). | The two views can never diverge. |
| D6 | Unresolved links are surfaced only for **relevant** files (changed or affected). | Links in unrelated files are noise. |
| D7 | `inferred` labels only **name-proximity test matches**, never affected files. | An affected file is always reached by a resolved edge (confirmed) or is depth-limited (unverified). |

---

# Test Suite Summary

```
npx vitest run
─────────────────────────────────────────────────────────────
 Test Files  5 passed (5)
      Tests  63 passed (63)

 ✓ test/fileFilter.test.ts      (18 tests)  Source inclusion / rejection rules
 ✓ test/parser.test.ts          ( 6 tests)  Import extraction with line accuracy
 ✓ test/resolver.test.ts        (11 tests)  Aliases, barrels, .js → .ts, unresolved
 ✓ test/graphBuilder.test.ts    (14 tests)  Nodes, edges, multi-edges, cycles
 ✓ test/impactAnalysis.test.ts  (14 tests)  Reverse search, labels, evidence, tests
```

All tests pass from **both** the repository root and `packages/analyzer`.

### Known non-blocking issue
`npx tsc --noEmit` reports **3 pre-existing type errors** in `graphBuilder.ts` (Days 4–6) caused by graphology's default-export typing. They are unrelated to Days 7–8 and do not affect the tests, which run through esbuild/Vitest. Not yet fixed.

---

# What Is Next (not part of this record)

| Days | Goal | Success condition |
| --- | --- | --- |
| **9–10 (next)** | Fastify API, SQLite cache `(repo, sha)`, job queue + polling, Chrome Extension (Manifest V3) skeleton, React Flow graph | Clicking **Analyze Repository** on GitHub draws a graph |
| 11–12 | PR page: changed files → run this impact engine → labelled side panel | **Analyze Change Impact** shows labelled findings |
| 13–14 | Grounded LLM explanation with validation, Docker, deploy, README, demo | A public link and a recorded demo exist |
| After | Evaluation | Precision and recall numbers |

---

# PIVOT: Chrome Extension → Website (Days 9–12)

> The project pivoted from a Chrome extension to a website after Day 8. The analyzer engine, labels (`Confirmed`/`Inferred`/`Unverified`), evidence chains, cache, and job model were kept unchanged. The extension code was removed from `main` and preserved on branch `archive/extension`.

**Key decisions accepted during the pivot**
- API port `8787`; side-panel results became web pages; backend resolves branch → SHA.
- `sql.js` replaces `better-sqlite3` (native build failed on this machine); real SQLite semantics via WASM, persisted to a file.
- Rate limiting: `@fastify/rate-limit@^8.0.0` (11.x needs Fastify 5; 6.x incompatible with Fastify 4).
- Repo limits: 100 MB tarball, 5000 analyzed files.
- PR analysis builds base + head graphs, runs `analyzeImpact()` on the head graph with changed filenames, depth limit 3.
- Production: Fastify serves the website from the same origin (no CORS needed in prod).

---

## Day 9 — Pivot: API + URL resolution

**Files:**
- `packages/analyzer/src/github/parseGithubUrl.ts`
- `packages/analyzer/src/github/resolveRef.ts`
- `apps/api/src/cache/graphCache.ts` (sql.js)
- `apps/api/src/jobs/queue.ts`
- `apps/api/src/routes/analyze.ts`, `jobs.ts`, `graph.ts`, `health.ts`
- `apps/api/src/server.ts`
- `apps/api/test/*.test.ts`

### What it does
Parses a pasted GitHub URL into repo / commit / pull kind; resolves a branch or tag to an exact commit SHA; starts a background analysis job with polling; serves health, analyze, jobs, and graph routes under `/api`.

### How it does it
- `parseGithubUrl()` returns `{ kind: 'repo' | 'commit' | 'pull', owner, repo, sha?, ref?, number? }` or an error code (`UNSUPPORTED_HOST`, `INVALID_URL`, etc.).
- `resolveRef()` looks up `default_branch` via the GitHub API, then resolves the branch name to a 40-char SHA through `/commits/{ref}`; slash branches try progressively shorter prefixes.
- The cache is keyed `(owner, repo, sha)` and stores only `GraphAnalysis`. PR results are **not** cached as impact results.
- `sql.js` (WASM) replaces `better-sqlite3`: `.get()` returns `[]` when no row and a positional array when found; WASM path resolved with four `..` from `apps/api/src/cache`.
- Routes are registered under `{ prefix: '/api' }` so every endpoint is `/api/health`, `/api/analyze`, `/api/jobs/:id`, `/api/graph/:owner/:repo/:sha`.
- Fastify CORS allows `http://localhost:5173` and production origin; rate limit is 10 requests/minute per IP.

### Why this way
- SHA (not `main`) makes the result deterministic and cacheable.
- SQL via WASM avoids native `node-gyp` compilation, which failed on this Windows machine.
- API-first, UI-second: every endpoint is testable from `curl`/vitest before any React code exists.

### Tests
- `parseGithubUrl.ts` — 21 tests (repo, commit, pull, invalid URLs).
- `resolveRef.ts` — 8 tests (SHA passthrough, default branch, branch name, slash prefixes, 404/403/network errors).
- Analyzer: **92/92 tests** passing.
- API: **16/16 tests** passing.

---

## Day 10 — Pivot: Website (Vite + React + Router + React Flow)

**Files:**
- `apps/web/` (new Vite + React + TypeScript + Tailwind project)
- `apps/web/src/pages/Landing.tsx`
- `apps/web/src/pages/RepoResults.tsx`
- `apps/web/src/pages/JobResults.tsx`
- `apps/web/src/components/GraphView.tsx`
- `apps/web/src/hooks/usePolling.ts`
- `apps/web/src/api.ts`
- `apps/web/vite.config.ts`
- `apps/web/src/App.tsx`

### What it does
A single-page website where the user pastes a GitHub URL, clicks Analyze, waits for the job, then sees a React Flow dependency graph of the repository with clickable nodes and GitHub links.

### How it does it
- **Landing:** URL input, client-side validation, example links, submits to `POST /api/analyze`.
- **JobResults:** polls `GET /api/jobs/:id` every 1.5 s; on `done` redirects to `/repo/:owner/:repo/:sha`; on `failed` shows the error.
- **RepoResults:** fetches `GET /api/graph/:owner/:repo/:sha` (cached) or starts a fresh analyze job; renders `GraphView`.
- **GraphView:** layered column layout by dependency depth; arrows labelled with import specifiers and kind color-coded; clicking a node opens a details panel with imports/importers, line numbers, and a "View on GitHub" link; footer shows `files • imports • unresolved`.
- **API client:** calls `http://localhost:8787/api/...` directly in dev (CORS allowed by the API); same-origin in production.
- **Vite proxy:** `/api` → `http://localhost:8787` for development convenience.

### Why this way
- A full page replaces the cramped extension side panel; long evidence chains are readable.
- Vite + React + Tailwind was already known from the extension work, needs no server rendering.
- API-first then UI: all routes were already tested before the UI existed.

### Build
`npm run build` succeeds (~360 KB gzipped bundle). `apps/web` has no test files yet (vitest exits 1 with "No test files found" — tracked for Day 14 CI).

---

## Day 11 — Pivot: Pull Request analysis (API)

**Files:**
- `packages/analyzer/src/github/pr.ts`
- `apps/api/src/jobs/prAnalysisJob.ts`
- `apps/api/src/routes/analyze.ts`
- `apps/api/src/jobs/queue.ts`
- `apps/api/src/server.ts`
- `apps/api/test/routes.test.ts`

### What it does
Accepts a PR URL, fetches PR metadata and changed files (with pagination, 3000-file cap), builds base + head graphs, runs `analyzeImpact()` on the head graph, and returns `PRAnalysisResult` with `number`, `title`, `state`, `baseSha`, `headSha`, `changedFiles`, and `impact`.

### How it does it
- `fetchPRMetadata()` calls `GET /repos/{owner}/{repo}/pulls/{number}`; returns `number`, `title`, `state`, `head_sha`, `base_sha`, fork info.
- `fetchPRChangedFiles()` paginates `GET /repos/{owner}/{repo}/pulls/{number}/files`; caps at 3000 files (returns `PR_TOO_LARGE` → HTTP 413).
- The `analyze` route branches on `parsed.kind === 'pull'`: fetches metadata + changed files, checks cache, then enqueues a `kind: 'pr'` job.
- `prAnalysisJob` builds the base graph (at `baseSha`), builds the head graph (at `headSha`), runs `analyzeImpact(headGraph, { changedFiles, depthLimit: 3 })`, returns the PR result.
- `JobRecord` gained `kind`, `prNumber`, `baseSha`, `changedFiles`; `prTitle`/`prState` added in the Day 12 fix.
- `fetchPRChangedFiles` returns `{ code: 'PR_TOO_LARGE' }` when ≥3000 files (mapped to HTTP 413).

### Why this way
- Base + head graphs let the impact analysis show what the PR actually affects relative to where the code was.
- Changed files from the PR API are the *seeds* for the reverse search — the analyzer engine stays pure.

### Tests
- 5 new PR route tests added to `apps/api/test/routes.test.ts`.

---

## Day 12 — Pivot: PR results page (website) + fixes

**Files:**
- `apps/web/src/pages/PRResults.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/vite.config.ts`
- `apps/web/src/components/GraphView.tsx` (improved)
- `apps/web/src/pages/RepoResults.tsx` (improved)
- `apps/web/src/pages/JobResults.tsx` (routed PR → repo correctly)
- `apps/api/src/jobs/queue.ts` (added `prTitle`/`prState`)
- `apps/api/src/routes/analyze.ts` (PR cache-hit returns PR result, not plain graph)
- `apps/api/src/jobs/prAnalysisJob.ts` (`owner`/`repo` in result)
- `packages/analyzer/src/graph/graphBuilder.ts` (multi-edge graph)
- `packages/analyzer/src/github/resolveRef.ts` (default branch → real SHA)
- `packages/analyzer/test/graphBuilder.test.ts` + `resolveRef.test.ts` (new tests)

### What it does
A dedicated page at `/pr/:owner/:repo/:number` showing PR impact: header with repo/PR/title/base→head SHAs/GitHub link, unverified-count banner, changed-files table, findings grouped by label (Confirmed/Inferred/Unverified), evidence chains with "go to line" links, tests section, unresolved-links section, optional mini graph, read-only note.

### How it does it
- **Header:** `PR #{number}`, repo name, title, base→head SHAs (first 7 chars), "Open PR on GitHub" link.
- **Unverified banner:** plain words ("N links the tool could not resolve"), placed first per the plan.
- **Changed files:** table with filename, status badge (added/modified/deleted/renamed), +/- counts; empty state when no files changed.
- **Findings:** grouped Confirmed → Inferred → Unverified, each with file, depth, viaChangedFiles, collapsible evidence chain. Each hop: `from → to`, line number (go-to-line link to GitHub using head SHA for head-side files, base SHA for deleted files), kind, specifier.
- **Tests section:** titled "Tests that import affected code" with rule names and reason.
- **Unresolved links:** file, line, specifier.
- **Read-only note:** "This tool only reads the repository; it never changes it."
- **Fixes applied:**
  - API client base URL no longer contains `/api` — was producing `/api/api/analyze` → 404. Now `http://localhost:8787/api` + path `/api/analyze`.
  - `graphBuilder.ts` switched to `MultiDirectedGraph` so a file importing the same target from two lines doesn't crash graphology ("edge already exists").
  - `resolveRef.ts` now resolves the default-branch *name* to a real 40-char commit SHA (was leaking the branch name as the SHA).
  - PR cache-hit path returns a `PRAnalysisResult` (not a `GraphAnalysis`).
  - PR jobs now carry `prTitle`/`prState` from metadata.
  - Job page routes PR results to `/pr/...` and reuses the finished result (no double analysis).

### Why this way
- Color plus text/icons (✓ / ≈ / ?) so labels are readable without color alone.
- Go-to-line links use base SHA for deleted files so every link points at code that exists.
- Graph fixes unblock real repos (`sindresorhus/is` previously crashed on parallel edges).

### Verification
- Real repo `sindresorhus/is`: analyze → `202` → job `done` → 5 nodes / 6 edges; second call → `cached: true`.
- Real PR `sindresorhus/is#217`: analyze → `done` → title + state + 2 changed files populated.
- Analyzer: **93/93 tests** (15 graphBuilder tests including parallel-edge regression).
- API: **16/16 tests** passing.
- Website: typecheck + production build pass.

---

## Days 13–14 — Pending

| Day | Goal | Status |
| --- | --- | --- |
| **13** | LLM explanation (prompt, validator, cache, budget) + Fastify static serving + Docker | ⬜ pending |
| **14** | GitHub Actions CI, deploy, README, recorded demo | ⬜ pending |
