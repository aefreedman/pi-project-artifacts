# File Todo Tool Reference

- `project_todo_validate` — scan all todo Markdown and report non-canonical/conflicting files without mutation.
- `project_todo_list` — list canonical identities and content hashes.
- `project_todo_inspect` — inspect one canonical path.
- `project_todo_allocate` — preview next ID plus a directory hash; it does not reserve the ID.
- `project_todo_create` — allocate and create exclusively under the todo lock.
- `project_todo_transition` — atomically change filename/frontmatter status using an expected content hash.

Do not replace these operations with shell maximum-plus-one allocation or separate rename/edit commands. Raw search remains useful for investigative text matching, but it is not a lifecycle mutation mechanism.
