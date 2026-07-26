# Triage Pending Todos

1. Resolve roots, then list pending items: `ls ${TODOS_ROOT}/*-pending-*.md`
2. For each todo:
   - Review Problem Statement and Findings.
   - Review Proposed Solutions.
   - Decide: approve, defer, or change priority.
3. For approved todos:
   - Rename file: pending -> ready.
   - Update frontmatter status to `ready`.
   - Fill Recommended Action section.

Use `/triage` if available for interactive approval.
