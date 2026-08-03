# Changelog

## Unreleased

### Added

- Canonical generic `project_artifact_describe` and `project_artifact_search` Pi tools with session-scoped `ArtifactSearchServiceV1` lifecycle registration.
- Pure Markdown parsing, canonical index-v1 envelope validation, root identity, deterministic filtering/ranking/formatting, add/update/delete refresh, dirty/TTL freshness, physical containment, owned locking, orphan cleanup, and atomic cache writes under `.pi-project-artifacts/index-v1*.json`.
- Open top-level frontmatter discovery and exact raw filtering with optional profile-defined types, enums, applicability, validation provenance, and agent-visible `raw_exact`, `profile_validated`, or `profile_warning` semantics.
- Deterministic `project_todo_validate`, `project_todo_list`, `project_todo_inspect`, `project_todo_allocate`, `project_todo_create`, and `project_todo_transition` adapters over `TodoLifecycleServiceV1`.
- Locked/hash-guarded file-todo allocation, staging, exclusive target creation, physical containment, normalized collision checks, external-edit detection, rollback, and non-mutating pre-existing conflict diagnostics.
- `file-todos` skill as a thin canonical-tool workflow with skill-relative assets, including authoritative todo triage formerly exposed as a workflow prompt.
- `using-project-artifacts` baseline skill for authoritative Markdown research, optional plans/solutions/memories conventions, schema-aware candidate retrieval, exhaustive-search routing, and source-read verification.
- `grooming-project-artifacts` skill for evidence-backed documentation and todo cleanup with explicit mutation authority and owning-migrator boundaries.
- `/memorize` prompt for verified, deduplicated, owner-resolved project-learning capture targeted exclusively to the project's `solutions/` or `memories/` domain, without model/global-memory claims or a `/compound` compatibility alias.
- Artifact/todo characterization, failure-injection, root-isolation, malformed-input, ordering, lock, atomicity, path, collision, Pi registration, and behavioral-eval fixtures, including baseline documentation-skill activation and search-routing seeds.
- Public artifact-profile provider development guidance covering optional package composition, registry rendezvous, scoped lifecycle, conformance testing, and schema evolution.

### Changed

- Made all supported top-level metadata fields exact-filterable without schema registration; mixed generic/profile and multi-profile field names remain open raw data while profiles add per-artifact confidence instead of permission.
- Re-evaluate profile applicability and validation on every non-fast refresh, while rewriting the index only when resulting profile data changes.
- Kept generic `status`, `priority`, and `severity` filters as unrestricted exact strings for arbitrary Markdown rather than todo-centric enums.
- Made artifact description workspace-aware through the canonical contained index, exposing applicable profile definitions and a bounded privacy-safe observed-field catalog; search exposes the same observations plus validation diagnostics.
- Redacted credential-shaped and sensitive-name metadata from returned result summaries and observed samples while preserving field counts, inferred primitive types, and raw filtering.
- Updated the Pi development baseline to 0.83.0.

- Expanded the Wave 0 side-effect-free v1 artifact/todo contracts into the independently installable canonical Pi package without changing their frozen request/result shapes.
- Documented preview-only body indexing, schema-open YAML-frontmatter candidate filters, optional profile enrichment, and visible validation confidence; direct source search/read remains required for exhaustive or final evidence.
- Made todo status transitions crash-resumable through durable hash-bound journals and deterministic locked recovery.
- Hardened owned interprocess locks with nonce-qualified quarantine reclamation and release ownership verification.
- Revalidated nearest physical ancestry immediately before index, lock, stage, journal, and todo mutation I/O.
- Bound artifact and todo service invocations to the session-approved physical `ctx.cwd`, preserving nested child workspaces while rejecting parent, sibling, external absolute-root, and symlink/junction escapes before lock/read/write activity.
- Kept the approved cwd and registry scope in the package-copy-safe private execution binding without adding scope fields to public contracts.
- Co-install the capability-registry tarball instead of recursively bundling decomposition repositories.
- Regenerated the lockfile against the published `@aefree/pi-capability-registry` tarball so clean installs no longer depend on a sibling workspace link.

### Removed

- Retired pi-game-dev legacy-reference registration, its pinned compatibility payloads, and retired Compound Game Dev slash-command aliases. Use the canonical project artifact and file-todo tools instead.

### Safety

- Legacy `.compound-game-dev` caches and existing project todo Markdown are never migrated or reconciled by package installation or search.
