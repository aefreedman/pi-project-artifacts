# Triage Project Todos

Triage is read-only by default. Applying status decisions, repairing artifacts, editing recommended actions, or updating an external tracker requires separate explicit mutation intent.

1. Resolve the exact workspace and todos root. Read applicable project instructions, then call `project_todo_validate`.
2. Stop lifecycle mutation on malformed names, filename/frontmatter disagreement, duplicate IDs, or normalized path collisions. Consuming projects own reconciliation; never repair conflicts with ad hoc renames or edits.
3. Call `project_todo_list` and inspect only the requested pending/ready scope. Preserve protected artifacts.
4. Classify each item by impact, urgency, evidence, dependencies, overlap, readiness, and next action. Group results as `ready`, `blocked`, `deferred`, `rejected/duplicate`, or `decision-needed` without changing status merely to match the recommendation.
5. Present source-backed recommendations and distinguish artifact changes, external tracker changes, evidence gaps, and remediation.
6. For separately approved content work, make only the authorized update and obtain a fresh content hash through inspect/list.
7. Call `project_todo_transition` only for an explicitly approved status change, using the current path, destination status, and fresh expected content hash.
8. Re-inspect the transitioned path before reporting completion.

Delegate only independent read-only inventory slices when useful. The root session owns lifecycle mutations and synthesis. Never perform a separate filename rename and frontmatter status edit.
