# Changelog

## 0.1.2 - 2026-09-21

### Changed

- Update Pi development dependencies and validation baseline to 0.87.0.

## 0.1.1 - 2026-09-20

### Changed

- Updated Pi development dependencies and validation baseline to 0.86.1.

### Changed

- Added GitHub Actions trusted publishing for tested, provenance-backed npm releases with tag/version identity checks and safe retry reconciliation.

## [0.1.0] - 2026-08-03

### Added

- Canonical `project_artifact_describe` and `project_artifact_search` Pi tools for authoritative project Markdown under configurable, workspace-contained docs and todos roots.
- Schema-open top-level frontmatter discovery and normalized exact filtering, with mixed project schemas supported in one workspace.
- Optional artifact profiles that contribute field definitions, applicability, validation provenance, and agent-visible `raw_exact`, `profile_validated`, or `profile_warning` confidence without gating raw metadata access.
- Progressive-disclosure observed-field catalogs: compact discovery lists every field name/count, while detailed focused inspection adds bounded types, cardinality, and credential/path-suppressed samples.
- Context-aware search metadata that reports query/filter-relevant facets, todo state, bounded profile evidence, and explicit truncation instead of repeating fixed labels or complete frontmatter.
- Preview-based body indexing with explicit direct-`rg` and source-read guidance for exhaustive or final evidence.
- Explicit cache-state reporting for auto-TTL reuse, memory reuse, unchanged validation scans, and rebuilds, plus consumer `.gitignore` guidance for disposable indexes.
- Compact default TUI rendering for artifact and todo tool results, with full output available through Pi's standard expanded-tool toggle.
- Canonical index-v1 refresh, deterministic ranking and formatting, stable root identity, physical containment, owned locking, orphan cleanup, and atomic cache writes under `.pi-project-artifacts/`.
- Deterministic `project_todo_validate`, `project_todo_list`, `project_todo_inspect`, `project_todo_allocate`, `project_todo_create`, and `project_todo_transition` tools.
- Locked and hash-guarded todo allocation, exclusive creation, external-edit detection, durable transition recovery, rollback, collision diagnostics, and non-mutating handling of pre-existing conflicts.
- `using-project-artifacts`, `file-todos`, and `grooming-project-artifacts` skills for authoritative Markdown research and controlled artifact maintenance.
- `/memorize` prompt for one verified, deduplicated project learning targeted exclusively to the project's `solutions/` or `memories/` domain.
- Side-effect-free v1 artifact-profile, artifact-search-service, and todo-lifecycle contracts with reusable provider conformance helpers.
- Public artifact-profile provider guidance covering optional package composition, registry rendezvous, scoped lifecycle, conformance testing, and schema evolution.

### Safety

- Every artifact and todo invocation is bound to the session-approved physical workspace; parent, sibling, external absolute-root, and symlink or junction escapes fail before protected I/O.
- Sensitive-name and credential-shaped metadata is redacted from result summaries and observed samples.
- Pre-existing `.compound-game-dev` caches and project todo Markdown are never migrated, reconciled, moved, or deleted by package installation or artifact search.
- Runtime dependencies resolve from published npm sources without sibling workspace links or recursively bundled decomposition repositories.
- The consumer package contains generated runtime JavaScript and declarations, public Pi resources, and user/provider documentation; authored source, tests, and behavioral evals remain repository-only.
