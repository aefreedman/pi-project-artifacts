# @aefree/pi-project-artifacts

Canonical project-local Markdown discovery and deterministic file-todo lifecycle infrastructure for Pi. Project Markdown remains authoritative; indexes and tool output accelerate discovery but do not replace source evidence.

## Pi resources

- tools: `project_artifact_describe`, `project_artifact_search`
- tools: `project_todo_validate`, `project_todo_list`, `project_todo_inspect`, `project_todo_allocate`, `project_todo_create`, `project_todo_transition`
- prompt: `/memorize`
- skills: `using-project-artifacts`, `file-todos`, `grooming-project-artifacts`

The package registers `ArtifactSearchServiceV1` and `TodoLifecycleServiceV1` per Pi session. It owns the side-effect-free artifact profile/service contracts under `@aefree/pi-project-artifacts/contracts/v1`; providers such as `pi-unity` register through those contracts in either load order.

`/memorize` persists one verified reusable learning as authoritative project Markdown in either the project's `solutions/` domain (verified technical problem/resolution) or `memories/` domain (verified durable non-solution knowledge). Invocation authorizes only one resolved artifact creation or focused update; evidence, duplicate detection, destination resolution, profile constraints, and post-write validation remain mandatory. It never routes output to another artifact class or claims model, session, or global user memory.

`grooming-project-artifacts` owns the read-first procedure for organizing, normalizing, deduplicating, and optionally cleaning up project Markdown. It uses structured artifact search plus exact source evidence, leaves profile-defined migrations to owning migrators, and requires explicit authority before edits.

## Artifact indexes

Authoritative data remains project Markdown under resolved docs/todos roots. Every artifact and todo invocation is privately bound to the session's physical `ctx.cwd`: the selected workspace and custom docs/todos roots must resolve to that directory or a physical descendant. Parent, sibling, home, and symlink/junction escapes fail before lock acquisition or artifact/todo reads and writes. Nested child repositories remain supported when a coordination workspace is the session cwd.

Derived indexes use:

```text
<workspace>/.pi-project-artifacts/index-v1.json
<workspace>/.pi-project-artifacts/index-v1-<label>-<hash>.json
```

The v1 envelope identifies its schema, workspace/docs/todos physical roots, stable root identity, contributing profiles, content hashes, and complete entries. Strict refresh detects add/update/delete and external edits. Auto mode uses dirty tracking plus a bounded TTL; memory mode deliberately trusts the loaded index.

Legacy `.compound-game-dev/artifact-index*.json` files are never read by default, imported, moved, or deleted. An explicit occupied `indexPath` is replaced only when absent or when its entire canonical/legacy owned envelope validates. Unrelated JSON, malformed envelopes, authoritative-root overlap, and physical symlink/junction escapes fail closed.

Index writes use process-local queues, schema-owned interprocess locks, exclusive temporary files, file sync, atomic replacement, orphan-temp cleanup, and structured stale/malformed-lock diagnostics. Locks carry random nonces; dead-owner reclamation and release first rename to a nonce-qualified quarantine and verify ownership before deletion.

## Documentation discovery and profiles

Markdown files under the resolved project roots are authoritative. `docs/plans/`, `docs/solutions/`, and `docs/memories/` are recognized optional conventions, not required roots or a restriction on other documentation. Solutions hold verified technical problem/resolution learnings; memories hold verified durable project knowledge that is not a solution. The package never creates these directories or artifacts automatically.

`project_artifact_search` indexes and exact-filters every supported top-level YAML-frontmatter key without requiring a known schema or an installed profile. It supports mixed and custom metadata schemas in one workspace. Use `project_artifact_describe` to report known generic/profile definitions and workspace-applicable profile availability; use `project_artifact_search` for parse/index/filter/rank/freshness candidate retrieval, bounded observed metadata, and validation diagnostics. Then read the selected Markdown for final evidence.

- The index stores only a body preview: body search/snippets and observed metadata are bounded candidate signals, not exhaustive full-body, complete-field-inventory, or exact-match evidence. Use direct `rg` against source files for exhaustive, literal, or complete-occurrence searches, then read the matching files.
- YAML frontmatter is a schema-open fast path: use exact `filters` values for any supported top-level metadata field, including fields not described by a profile.
- Search results label exact raw metadata matches as `raw_exact`; a compatible profile may additionally label them `profile_validated` or `profile_warning`. These labels report confidence/diagnostics and never change whether the raw exact filter is permitted.
- Profiles optionally enrich known fields with types, enums, applicability, and diagnostics. They never grant or withhold permission to discover or filter metadata, and no profile is required for generic or unknown-field search.
- Arbitrary project Markdown and its metadata remain authoritative, readable source material; the index, definitions, availability, observations, and profile results are derived aids.

## Atomic file todos

Canonical identity:

```text
{positive-id-rendered-to-at-least-3-digits}-{pending|ready|complete}-{p1|p2|p3}-{kebab-description}.md
```

The lifecycle service:

- validates filename/frontmatter identity and diagnoses malformed files, duplicate numeric IDs, and normalized/case-fold collisions;
- treats pre-existing conflicts as consumer-owned and blocks mutation without repair;
- computes directory/content hashes for optimistic concurrency;
- allocates again under a root lock and creates final targets exclusively;
- stages create content and rolls back only writes whose hash still proves run ownership;
- records transitions in durable per-run journals with source/target hashes, allowing a later locked mutation to deterministically resume a published destination or roll back a transition that never published one after process death;
- serializes root allocation plus canonical per-file mutation queues; the Pi transition adapter also joins Pi's shared `withFileMutationQueue` for built-in edit/write coordination;
- changes transition filename/frontmatter status together while preserving body and unknown frontmatter text;
- validates both session-cwd containment and operation-root containment before I/O and never follows todo symlink aliases.

An allocation result is a preview, not a reservation. Use its `directoryHash` with `project_todo_create` when possible. Use a fresh `contentHash` with `project_todo_transition`.

## Contracts

Public subpaths:

- `@aefree/pi-project-artifacts/contracts/v1`
- `@aefree/pi-project-artifacts/contracts/v1/conformance`
- `@aefree/pi-project-artifacts/core`
- `@aefree/pi-project-artifacts/pi`

Provider/runtime callbacks receive fresh execution contexts and invocation-owned cancellation. Registry state is scoped by `ctx.sessionManager`, uses stale-safe registration tokens, and is resolved at execution time.

## Independent packaging

`@aefree/pi-capability-registry` is a semver dependency co-installed by the consumer. Decomposition packages are not recursively bundled, which prevents sibling workspace links or duplicate physical implementations from entering tarballs. Pi runtime packages remain optional peers.

```bash
npm test
npm pack --dry-run
```

Behavioral eval seeds live under `evals/file-todos/` and `evals/artifact-research/`; they cover baseline artifact-skill activation and safe search routing as well as todo behavior. Live model trials are opt-in and not part of `npm test`.
