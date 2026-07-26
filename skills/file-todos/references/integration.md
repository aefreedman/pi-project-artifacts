# Integration with Workflows

| Trigger | Flow | Tool |
|---------|------|------|
| Code review | /cg-review -> findings -> /cg-triage -> todos | Review agent + skill |
| Review follow-up | /cg-review-resolve -> triage -> fixes -> todos | Prompt + skill |
| Code TODOs | /cg-resolve-todo-parallel -> fixes + complex todos | Agent + skill |
| Planning | /cg-plan -> create todo if needed -> /cg-work -> complete | Prompt + skill |
| Feedback | Discussion -> create todo -> triage -> work | Skill + slash |
