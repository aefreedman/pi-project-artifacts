# Artifact Root Resolution

Purpose: resolve physical artifact directories for `docs/` and `todos/`
conventions without hardcoding project-specific workspace naming in shared skills.

## Definitions

- `WORKSPACE_ROOT`: project workspace root where artifacts are stored.
- `COORDINATION_ROOT`: optional parent directory that hosts multiple workspaces.
- `DOCS_ROOT`: `${WORKSPACE_ROOT}/docs`
- `TODOS_ROOT`: `${WORKSPACE_ROOT}/todos`

## Project Adapter

Load project-specific workspace rules from `artifact-roots.config.yaml` when present
in the current directory or any ancestor.

The adapter defines:

- Workspace candidate naming patterns
- Required workspace markers
- Selection priority rules
- Safety guards for coordination roots

Shared skills MUST NOT embed project-specific names or marker assumptions.

## Resolution Priority

1. Explicit workspace/path from user input
2. Current working directory if it is already inside a workspace
3. Session-local environment variable declared in adapter priority list
4. Auto-select only when exactly one valid workspace exists
5. Ask one targeted question when still ambiguous

## Required Behavior

1. Resolve `WORKSPACE_ROOT` before any `docs/` or `todos/` read/write.
2. Use physical paths via `DOCS_ROOT` and `TODOS_ROOT` in templates and outputs.
3. Map any `docs/...` or `todos/...` references to physical roots before reporting paths.
4. If operating from a coordination root, never create unresolved root-level
   `docs/` or `todos/` directories.
5. Validate resolved workspace markers before writing.

## Safety Checks Before Writes

- Target must be under `DOCS_ROOT` or `TODOS_ROOT`.
- If target would land under unresolved `COORDINATION_ROOT/docs` or
  `COORDINATION_ROOT/todos`, fail fast and report the mis-resolution.
- If environment selection is invalid, ignore it and continue down priority list.

## Reporting

When a workflow reads or writes artifacts, include resolved root context in
status output when ambiguity is possible.
