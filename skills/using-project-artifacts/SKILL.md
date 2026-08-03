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

1. Use `project_artifact_describe` when known definitions, optional profile types/enums/applicability, or workspace-specific profile availability would help interpretation. It does not authorize or gate metadata discovery or filtering.
2. Use `project_artifact_search` for fast candidate retrieval, bounded observed metadata, and diagnostics. It exact-filters every supported top-level YAML-frontmatter field without a known schema, so use exact filters for known or unknown fields and scoped searches for established plans, solutions, memories, docs, or todos. Mixed and custom schemas may coexist. Interpret result semantics: `raw_exact` is a raw exact metadata match, while a compatible profile can additionally report `profile_validated` or `profile_warning` confidence.
3. For exhaustive full-body search, literal/exact matching, a complete occurrence count, or a complete metadata inventory, use direct `rg` over the resolved source roots, then read the matches. Do not represent indexed bodies or bounded observations as exhaustive evidence.
4. Use `discover_candidate_files` only for a narrow unfamiliar ownership question with multiple plausible documentation-and-code homes. It is not the default for ordinary documentation search.
5. Read the selected files before citing, changing, or relying on them. Arbitrary Markdown remains authoritative and readable; report the paths and evidence actually read.

## Writing boundary

Research does not authorize documentation changes. Create or update an artifact only with explicit authority, an established destination, and the applicable project or profile schema. Keep unverified hypotheses out of solutions and memories.
