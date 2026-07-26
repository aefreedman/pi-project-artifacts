---
name: file-todos
description: Manage canonical project file todos with deterministic validation, inspection, allocation, creation, and atomic status transitions. Use for Markdown todos under a resolved todos root.
---
# File-Based Todo Tracking

Use the `project_todo_*` tools. Do not allocate IDs with shell pipelines, create todo files with generic write/edit, or perform separate rename-plus-frontmatter edits.

## Root Resolution

Resolve the exact workspace first. Pass `workspaceRoot` when Pi is running from a coordination root or any directory that is not the intended artifact workspace. `todosRoot` defaults to `<workspaceRoot>/todos`; pass it only for an explicit custom root.

The tools perform lexical contract validation plus physical root containment immediately before I/O. They reject symlink/junction escapes. Report the physical todo paths returned by the tools.

## Read and Validation Workflow

1. Call `project_todo_validate` to identify malformed names, filename/frontmatter disagreement, duplicate numeric IDs, normalized path collisions, and other pre-existing conflicts.
2. Use `project_todo_list` for canonical todos and their content hashes.
3. Use `project_todo_inspect` before a transition or when one todo needs focused diagnostics.
4. Treat any `preexisting_todo_conflict` as blocking. Canonical tools diagnose but never reconcile existing project Markdown.

## Creation

1. Optionally call `project_todo_allocate` to preview the next ID and capture `directoryHash`.
2. Call `project_todo_create` with typed `title`, `priority`, optional canonical `status`, Markdown `body`, optional data-only frontmatter, and the captured `expectedDirectoryHash` when available.
3. Use the created path and content hash from the result.

Creation allocates again under the root lock, stages content, creates the final target exclusively, verifies it, and rolls back owned writes on failure. The allocation preview never reserves an ID by itself.

Canonical filename:

```text
{issue_id}-{status}-{priority}-{description}.md
```

- `issue_id`: positive decimal rendered to at least three digits
- `status`: `pending | ready | complete`
- `priority`: `p1 | p2 | p3`
- `description`: canonical lowercase kebab-case generated from the title

Use [assets/todo-template.md](assets/todo-template.md) when composing a substantial body. Submit completed content rather than placeholders.

## Status Transitions

1. Inspect/list the todo and capture its exact `contentHash`.
2. Call `project_todo_transition` with the current path, destination status, and `expectedContentHash`.
3. If `content_changed` is returned, inspect again; do not retry with a guessed hash.

Transition updates the filename and top-level frontmatter status as one locked, staged, exclusive operation with rollback. It preserves the body and unknown frontmatter text.

## Supporting Guidance

Load only when needed, relative to this skill directory:

- [references/triage.md](references/triage.md)
- [references/dependencies.md](references/dependencies.md)
- [references/work-logs.md](references/work-logs.md)
- [references/integration.md](references/integration.md)

The legacy shell command reference remains packaged for compatibility mapping, but canonical workflows use tools instead.
