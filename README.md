# GitHub Knowledge Assistant

> **Evidence-backed Repository Exploration & Pull-Request Change-Impact Analysis**  
> A developer tool and Chrome extension for deterministic code dependency mapping, change-impact analysis, and grounded explanations for JavaScript & TypeScript repositories.

---

## 🌟 Overview

Navigating large, complex codebases and reviewing pull requests often leads to missed dependencies, unexpected regressions, and hours spent tracing import chains manually. While AI code assistants exist, naive LLM / RAG solutions frequently hallucinate file relationships and miss critical call-sites because they lack deterministic dependency awareness.

**GitHub Knowledge Assistant** solves this by enforcing a **static-analysis-first** methodology:
1. **Deterministic Static Analysis:** Parses exact ASTs using Tree-sitter WASM, resolves aliases and module paths via the TypeScript Compiler API, and constructs a directed dependency graph.
2. **Reverse Impact Traversal:** Performs depth-limited reverse graph traversal from modified files to identify every affected upstream consumer and test suite.
3. **Evidence-Linked Findings:** Every finding is strictly anchored to real file paths and 1-based source code line numbers.
4. **Grounded AI Explanations:** LLM summaries are strictly constrained to verified static analysis findings, preventing hallucinations.

---

## 🏗️ Architecture & Monorepo Layout

The project is structured as an npm workspaces monorepo:

```
github-knowledge-assistant/
├── packages/
│   └── analyzer/               # Pure, headless static analysis engine (Node.js/TS)
│       ├── src/
│       │   ├── fetcher/        # GitHub tarball streaming & source file filtering
│       │   ├── parser/         # Tree-sitter WASM AST parser & import extractor
│       │   ├── resolver/       # TypeScript Compiler API module resolution (Days 4–6)
│       │   ├── graph/          # Graphology directed dependency graph builder (Days 4–6)
│       │   └── cli/            # Standalone CLI tools for headless testing
│       ├── grammars/           # Pre-built Tree-sitter WASM binaries (JS & TS)
│       └── test/               # Vitest unit & integration test suite
├── apps/
│   ├── api/                    # Fastify backend with SQLite cache & job queue (Days 9–10)
│   └── extension/              # Chrome Extension (Manifest V3) with React Flow UI (Days 9–12)
├── fixtures/                   # Deterministic test repositories for fixture validation
├── tsconfig.base.json          # Shared TypeScript configuration
└── package.json                # Root monorepo workspace configuration
```

---

## 🚀 Key Features Built So Far (Milestone 1, Days 1–3)

### 1. GitHub Tarball Streaming Fetcher
- Downloads repository snapshots by exact commit SHA in a single HTTP stream.
- Replaces hundreds of individual GitHub API file requests with one atomic snapshot.
- Streams directly to disk to prevent memory overflows on large repositories.

### 2. High-Performance Source File Filter
- Whitelists only genuine source files (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`).
- Automatically filters out `node_modules`, build artifacts (`dist/`, `build/`), minified files (`*.min.js`), declaration files (`*.d.ts`), source maps, lockfiles, and media.
- Enforces a 2MB maximum per-file limit to avoid pathological AST edge cases.

### 3. Tree-sitter WASM AST Parser
- Uses `web-tree-sitter` compiled to WebAssembly — zero native C++ build requirements, 100% cross-platform (Windows, Linux, macOS).
- Extracts all four import variants via native Tree-sitter S-expression queries:
  - **Static Imports:** `import { a } from './module'`
  - **Re-exports:** `export * from './module'`, `export { x } from './module'`
  - **Dynamic Imports:** `import('./module')`
  - **CommonJS Requires:** `require('./module')`
- Captures accurate 1-based line numbers directly from the AST.

---

## 🧪 Testing & Verification

The core engine is backed by automated tests and verified against real GitHub repositories.

### Automated Unit Tests (24/24 Passing)
```bash
npx vitest run
```
```
Test Files  2 passed (2)
     Tests  24 passed (24)

✓ test/fileFilter.test.ts (18 tests)
  - Inclusion rules for all JS/TS extensions
  - Rejection rules for node_modules, build dirs, lockfiles, and minified bundles
  - File size threshold enforcement (> 2MB skipped)

✓ test/parser.test.ts (6 tests)
  - Static import extraction with line accuracy
  - Re-export and CommonJS require extraction
  - Dynamic import extraction
```

### Live CLI Demonstration
Extract all imports from any real GitHub repository directly from your terminal:

```bash
npx tsx packages/analyzer/src/cli/extractImports.ts <owner> <repo> <sha> [github-token]
```

**Example Run (`sindresorhus/is @ main`):**
```
============================================================
 GitHub Repository Intelligence Extension — Import Extractor
 Repository : sindresorhus/is @ main
============================================================

[1/4] Fetching repository tarball from GitHub...
      Saved to: ...\ghe-sindresorhus-is-main\repo.tar.gz

[2/4] Extracting and filtering source files...
      Total files in archive : 18
      Filtered out (skipped) : 13
      Source files to analyze: 5

[3/4] Initialising Tree-sitter parsers (WASM)...
      Tree-sitter WASM parsers ready.

[4/4] Extracting imports with line numbers:

  FILE                               LINE    KIND        IMPORT SPECIFIER
  ---------------------------------------------------------------------------
  source/index.ts                    1       static      ./predicates.js
  source/index.ts                    2       static      ./types.js
  source/predicates.ts               1       static      ./types.js
  source/predicates.ts               2       static      ./utils.js
  source/types.ts                    1       static      ./environment.js
  ---------------------------------------------------------------------------

Analysis Summary:
  Source files analyzed : 5
  Parse errors          : 0
  Imports found         : 19

Status: SUCCESS (Days 1-3 criteria verified)
```

---

## 🗺️ 14-Day Roadmap

- [x] **Days 1–3: Core Extraction Engine**  
  GitHub tarball fetcher, archive streaming, file filter, Tree-sitter WASM import extractor, and CLI verification.
- [ ] **Days 4–6: Resolution & Dependency Graph**  
  TypeScript Compiler API (`resolveModuleName`), `tsconfig.json` path mapping & alias resolution, `graphology` directed graph, and cycle guards.
- [ ] **Days 7–8: Impact Analysis & Finding Classification**  
  Reverse BFS traversal from changed files, depth limits, evidence chains, and finding classifications (*Confirmed*, *Inferred*, *Unverified*).
- [ ] **Days 9–10: API Server & Exploration UI**  
  Fastify API, SQLite cache `(repo, sha)`, job queue, and Chrome Extension Manifest V3 with React Flow interactive graph.
- [ ] **Days 11–12: Pull Request Side Panel**  
  GitHub PR page change detection, side panel injection, and deep-linking to GitHub line diffs.
- [ ] **Days 13–14: Grounded LLM Explanation & Evaluation**  
  Strict findings-only LLM prompt, output validation against static evidence, and benchmark evaluation.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Language** | TypeScript (strict mode, ES modules) |
| **AST Parsing** | `web-tree-sitter` (WASM), Tree-sitter S-expression queries |
| **Graph Modeling** | `graphology`, `graphology-traversal` |
| **Resolution** | TypeScript Compiler API (`resolveModuleName`) |
| **Backend API** | Fastify, SQLite (`better-sqlite3`), node-fetch |
| **Extension UI** | Chrome Manifest V3, React, React Flow, Tailwind CSS / Vanilla CSS |
| **Testing** | Vitest, TypeScript CLI fixtures |

---

## 💻 Getting Started Locally

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Setup
```bash
# Clone the repository
git clone https://github.com/DurgeshGatkal/GitHub-Knowledge-Assistant.git
cd GitHub-Knowledge-Assistant

# Install workspace dependencies
npm install

# Run the test suite
npm test --workspaces
```

---

## 📄 License

MIT
