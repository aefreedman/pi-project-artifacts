---
name: grooming-project-artifacts
description: Review and optionally clean up project Markdown documentation and todos using canonical artifact search, applicable profiles, exact source evidence, and owning migrators. Use when asked to groom, organize, normalize, deduplicate, or improve project docs or artifact metadata.
---
# Grooming Project Artifacts

Use this procedure for project Markdown documentation and todos. Authoritative Markdown remains the source of truth; disposable artifact indexes are derived state and must not be edited directly.

## Scope and Authority

Resolve the exact workspace plus explicit docs/todos roots and requested grooming policy. Ask one targeted question instead of scanning broadly when the roots, protected artifacts, or desired cleanup are unclear.

Inventory and recommendations are read-only. Edit files only when the user explicitly requests automatic cleanup or approves exact proposed changes. Commits, pushes, publishing, tracker changes, implementation-code changes, and specialized schema migrations require their own authority.

## Workflow

1. Read applicable project instructions and authoring guidance. Treat plans, solutions (verified technical problem/resolution learnings), and memories (verified durable non-solution knowledge) as optional existing conventions; identify protected artifacts, work logs, generated files, and domain-owned artifacts without restricting other docs.
2. Use `project_artifact_describe` when an applicable profile schema may matter; it exposes workspace-specific profile availability. Use `project_artifact_search` for structured, YAML-frontmatter-filtered candidate discovery and validation diagnostics within explicit roots. Its body index is preview-only: use bounded `rg` for exhaustive or literal body evidence, then read exact source files to verify every proposed finding.
3. Identify stale, duplicate, malformed, misplaced, weakly titled or tagged, inconsistent, and poorly linked artifacts. Separate observed defects from subjective editorial preferences.
4. Distinguish generic Markdown corrections from profile-defined or domain-specific schema work. Never perform a bulk specialized migration by hand when an owning migrator exists. If a required profile or owning capability is unavailable, leave affected documents unchanged and report the exact gap.
5. Prefer small, reviewable title, metadata, tag, status, placement, and cross-reference corrections. Do not rewrite documents wholesale merely for stylistic uniformity.
6. Present exact proposed edits before mutation unless automatic cleanup was explicit.
7. Apply only authorized, owner-supported edits. Preserve protected artifacts and use canonical todo tools for todo creation or status transitions rather than generic file edits.
8. Validate changed Markdown, links, metadata, filenames, todo identity, and relevant profile constraints. Report edits, intentionally unchanged documents, remaining recommendations, and evidence gaps.

## Delegation

Only the root session owns mutation and synthesis. Delegate only independent read-only inventory slices with exact roots and stop conditions; delegated workers must not mutate artifacts or launch nested agents.
