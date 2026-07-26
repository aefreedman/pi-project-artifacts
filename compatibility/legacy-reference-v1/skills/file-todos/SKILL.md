---
name: file-todos
description: Manage file-based todo tracking in the todos/ directory
---
# File-Based Todo Tracking Skill

## Overview

Todos are markdown files under `${TODOS_ROOT}` with YAML frontmatter and structured sections.
Use this skill to create, triage, and update file-based todos.

## File Naming Convention

```
{issue_id}-{status}-{priority}-{description}.md
```

- issue_id: sequential number (001, 002, ...)
- status: pending | ready | complete
- priority: p1 | p2 | p3
- description: kebab-case

## File Structure

Use the template at `skills/file-todos/assets/todo-template.md` via `cg_read_reference`.

Required sections:

- Problem Statement
- Findings
- Proposed Solutions
- Recommended Action
- Acceptance Criteria
- Work Log

## When to Create a Todo

Create a todo when work is more than trivial, needs research,
has dependencies, or requires triage. Act immediately for trivial fixes.

## Package Reference Loading

CRITICAL: Use `cg_read_reference` for Compound Game Dev package reference files.

- Pass package-relative paths such as `skills/file-todos/assets/todo-template.md`.
- When an instruction says to load, use, or see a package reference path, call `cg_read_reference` for that path.
- Do NOT use `read` with package-reference paths; file tools resolve relative to the current project cwd, not this package.
- Do NOT preemptively load all reference files.
- Treat loaded references as mandatory instructions for the active task scope.
- For long files, use `cg_read_reference` with `offset`/`limit` to load only needed sections.

## Root Resolution Requirement

Before any todo read/write, load:

- `references/_shared/artifact-root-resolution.md`
- `references/_shared/artifact-path-contract.md`

Then operate on `${TODOS_ROOT}` and use physical paths in templates and
user-facing descriptions.

## Reference Files (Load On Demand)

1. Template -> `skills/file-todos/assets/todo-template.md`
2. Triage -> `skills/file-todos/references/triage.md`
3. Dependencies -> `skills/file-todos/references/dependencies.md`
4. Work logs -> `skills/file-todos/references/work-logs.md`
5. Commands -> `skills/file-todos/references/commands.md`
6. Integration -> `skills/file-todos/references/integration.md`
7. Artifact root resolution -> `references/_shared/artifact-root-resolution.md`
8. Artifact path contract -> `references/_shared/artifact-path-contract.md`
