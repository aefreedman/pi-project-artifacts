---
description: Persist a verified reusable learning as authoritative project Markdown
argument-hint: "[verified-learning]"
---
# Memorize Project Learning

Candidate: $ARGUMENTS

## Input and authority

Use the supplied candidate, or inspect only the current conversation for one directly supported solved-problem candidate when none is supplied. Do not invent a learning or capture arbitrary conversation content.

Direct `/memorize` invocation authorizes creation or focused update of one resolved project-learning artifact. It does not authorize commits, pushes, publishing, tracker changes, implementation edits, bulk schema migrations, deletion, or storage outside the resolved project workspace.

This command writes durable project documentation. It does not alter model, session, or global user memory.

## Evidence and destination

Read applicable project instructions. Require direct outcome evidence: explicit user confirmation tied to the symptom, direct validation of the reported scenario, reproduced failure followed by an equivalent pass, or another recorded confirmation source. Bound cause and resolution claims to that evidence; if provenance is missing or ambiguous, report the gap and do not write.

Use `project_artifact_describe` when known definitions, optional profile types/enums/applicability, or workspace-specific profile availability may help select a destination; it never gates discovery or filtering. Use `project_artifact_search` with exact YAML-frontmatter filters on any supported top-level metadata field for fast candidate discovery, bounded observed metadata, and diagnostics, then exact source reads to inspect established documentation domains, related artifacts, and possible duplicates. This works across mixed Unity, Unreal, and custom schemas: `raw_exact` reports the raw exact match, while a compatible profile may add `profile_validated` or `profile_warning` confidence. Its body index and observed metadata are bounded; use direct `rg` followed by source reads for exhaustive or literal full-body duplicate checks or a complete metadata inventory. Arbitrary Markdown remains authoritative and readable.

The output target must be either the project's `solutions/` domain for a verified technical problem and resolution, or its `memories/` domain for verified durable non-solution knowledge. `docs/solutions/` and `docs/memories/` are common conventions, but resolve the project's established root, naming, and schema before writing. Do not route `/memorize` output to `plans/`, `patterns/`, general documentation, todos, or another artifact class. If the learning could reasonably be either a solution or a memory, or the corresponding project destination is not established, ask one narrow destination question instead of guessing or creating a directory from a generic convention.

## Capture workflow

1. Identify one verified reusable learning and its confirmation signals.
2. Check existing project artifacts for an equivalent or superseding entry. Prefer a focused update when one canonical artifact already owns the learning; do not overwrite unrelated content.
3. Classify the learning as a solution or memory, then resolve that artifact/domain owner and any applicable optional profile-defined schema. A missing profile never prevents searching or exact-filtering raw metadata; only a required owner-supported write contract or canonical `solutions/` or `memories/` destination blocks writing. In that case, return a draft candidate and exact remediation without writing a substitute document.
4. Capture the symptom or triggering context, established root cause, reusable resolution pattern, verification evidence, when to apply it, limitations and tradeoffs, anti-patterns, and bounded evidence/provenance. Follow the established domain schema rather than imposing a universal template.
5. Keep incident-specific names, commits, and dates only when useful as evidence. Exclude machine paths, raw private conversation content, credentials, secrets, and unnecessary external data bodies.
6. Create or update only the resolved artifact. Keep unrelated candidates separate and do not silently remove, archive, or supersede other entries.
7. Validate the changed Markdown, metadata, links, profile constraints, and discoverability through structured artifact search.
8. Report the created or updated path, evidence used, validation performed, skipped claims, and remaining gaps.

Only the root session owns mutation and synthesis. A delegated worker may research one already identified candidate read-only but must not write artifacts or launch nested agents.
