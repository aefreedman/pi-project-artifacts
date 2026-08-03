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

Use `project_artifact_describe` when profile schema discovery or workspace-specific profile availability may affect the destination. Use `project_artifact_search` with exact YAML-frontmatter filters for fast candidate discovery and validation diagnostics, then exact source reads to inspect established documentation domains, related artifacts, and possible duplicates. Its body index is preview-only; use direct `rg` for exhaustive or literal full-body duplicate checks. Select a clearly matching canonical domain. Existing `plans`, `solutions` (verified technical problem/resolution learnings), and `memories` (verified durable non-solution knowledge) are optional conventions, not mandatory destinations. If several destinations fit or none is established, ask one narrow destination question instead of creating a directory from a generic convention.

## Capture workflow

1. Identify one verified reusable learning and its confirmation signals.
2. Check existing project artifacts for an equivalent or superseding entry. Prefer a focused update when one canonical artifact already owns the learning; do not overwrite unrelated content.
3. Resolve the artifact/domain owner and any applicable profile-defined schema. If a required owner, profile, or canonical destination is unavailable, return a draft candidate and exact remediation without writing a substitute document.
4. Capture the symptom or triggering context, established root cause, reusable resolution pattern, verification evidence, when to apply it, limitations and tradeoffs, anti-patterns, and bounded evidence/provenance. Follow the established domain schema rather than imposing a universal template.
5. Keep incident-specific names, commits, and dates only when useful as evidence. Exclude machine paths, raw private conversation content, credentials, secrets, and unnecessary external data bodies.
6. Create or update only the resolved artifact. Keep unrelated candidates separate and do not silently remove, archive, or supersede other entries.
7. Validate the changed Markdown, metadata, links, profile constraints, and discoverability through structured artifact search.
8. Report the created or updated path, evidence used, validation performed, skipped claims, and remaining gaps.

Only the root session owns mutation and synthesis. A delegated worker may research one already identified candidate read-only but must not write artifacts or launch nested agents.
