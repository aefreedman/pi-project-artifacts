# Integration with Workflows

| Trigger | Flow | Tool |
|---------|------|------|
| Code review | Review findings → validate/list todos → create follow-up todos | Review workflow + `project_todo_*` tools |
| Review follow-up | Inspect/triage todos → make fixes → transition completed work | `project_todo_*` tools |
| Code TODOs | Inspect/triage todos → implement work → transition status | `project_todo_*` tools |
| Planning | Plan work → create a todo when needed → transition it when complete | `project_todo_*` tools |
| Feedback | Discuss → create a todo → triage → implement → transition status | `project_todo_*` tools |
