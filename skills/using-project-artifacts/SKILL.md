---
name: using-project-artifacts
description: Find and verify authoritative project Markdown documentation, plans, solutions, and durable memories with the canonical artifact tools. Use for project-documentation research, locating established conventions, or deciding where verified project knowledge belongs.
---
# Using Project Artifacts

Project Markdown is authoritative. The artifact index and tool results are candidate-finding aids, not a replacement for reading the document.

## Conventions and authority

Treat `docs/plans/`, `docs/solutions/`, and `docs/memories/` as optional conventions when they already exist:

- **plans** record intended work or decisions still being developed;
- **solutions** record verified technical problem/resolution learnings;
- **memories** record verified, durable project knowledge that is not a solution.

Other project documentation is unrestricted. Do not invent these directories, create an artifact automatically, or impose a package-wide schema. Follow the project's established schema and any applicable profile instead.

## Retrieval workflow

1. Use `project_artifact_describe` first when profile fields or a domain schema may matter. It exposes generic schemas plus workspace-applicable profile availability; do not guess profile fields.
2. Use `project_artifact_search` for fast candidate retrieval and validation diagnostics. Prefer exact YAML-frontmatter filters for known metadata and scoped searches for established plans, solutions, memories, docs, or todos. Its body index is preview-only, so it is not proof of every body occurrence.
3. For exhaustive full-body search, literal/exact matching, or a complete occurrence count, use direct `rg` over the resolved source roots. Do not represent indexed results as exhaustive body evidence.
4. Use `discover_candidate_files` only when ownership is unfamiliar and multiple plausible homes span documentation and code. It is not the default for ordinary documentation search.
5. Read the selected files before citing, changing, or relying on them. Report the paths and evidence actually read.

## Writing boundary

Research does not authorize documentation changes. Create or update an artifact only with explicit authority, an established destination, and the applicable project or profile schema. Keep unverified hypotheses out of solutions and memories.
