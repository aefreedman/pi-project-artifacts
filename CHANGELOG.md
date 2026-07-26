# Changelog

## Unreleased

### Added

- Canonical generic `project_artifact_search` Pi tool and session-scoped `ArtifactSearchServiceV1` lifecycle registration.
- Pure Markdown parsing, canonical index-v1 envelope validation, root identity, deterministic filtering/ranking/formatting, add/update/delete refresh, dirty/TTL freshness, physical containment, owned locking, orphan cleanup, and atomic cache writes under `.pi-project-artifacts/index-v1*.json`.
- Artifact-profile composition with indexed provider provenance, validator execution, independent profile-defined fields, generic no-profile search, and explicit `missing_profile` filter blocking.
- Deterministic `project_todo_validate`, `project_todo_list`, `project_todo_inspect`, `project_todo_allocate`, `project_todo_create`, and `project_todo_transition` adapters over `TodoLifecycleServiceV1`.
- Locked/hash-guarded file-todo allocation, staging, exclusive target creation, physical containment, normalized collision checks, external-edit detection, rollback, and non-mutating pre-existing conflict diagnostics.
- Preserved `file-todos` skill rewritten as a thin canonical-tool workflow with skill-relative assets and compatibility resources.
- Exact 11-row `LegacyReferenceServiceV1` registration for pi-game-dev compatibility reads with byte-exact pinned 0.6.4 payload copies, bounded content, and public provenance.
- Artifact/todo characterization, failure-injection, root-isolation, malformed-input, ordering, lock, atomicity, path, collision, Pi registration, and behavioral-eval fixtures.

### Changed

- Expanded the Wave 0 side-effect-free v1 artifact/todo contracts into the independently installable canonical Pi package without changing their frozen request/result shapes.
- Made todo status transitions crash-resumable through durable hash-bound journals and deterministic locked recovery.
- Hardened owned interprocess locks with nonce-qualified quarantine reclamation and release ownership verification.
- Revalidated nearest physical ancestry immediately before index, lock, stage, journal, and todo mutation I/O.
- Bound artifact and todo service invocations to the session-approved physical `ctx.cwd`, preserving nested child workspaces while rejecting parent, sibling, external absolute-root, and symlink/junction escapes before lock/read/write activity.
- Kept the approved cwd and registry scope in the package-copy-safe private execution binding so compatibility facades enforce the same boundary without adding scope fields to public contracts.
- Co-install the capability-registry tarball instead of recursively bundling decomposition repositories.

### Fixed

- Exported a package-copy-safe invocation-scope bridge so compatibility facades resolve the same artifact profiles as the canonical adapter.

### Safety

- Legacy `.compound-game-dev` caches and existing project todo Markdown are never migrated or reconciled by package installation or search.
