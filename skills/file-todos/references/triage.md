# Triage Pending Todos

1. Resolve the workspace and call `project_todo_validate`.
2. Stop on pre-existing conflicts; consuming projects own reconciliation.
3. Call `project_todo_list` and review pending items.
4. For approved items, fill the Recommended Action in separately authorized content work, then call `project_todo_transition` with the current path, `toStatus: ready`, and the exact content hash from a fresh inspect/list result.
5. Re-inspect the transitioned path before reporting completion.

Never perform a separate filename rename and frontmatter edit.
