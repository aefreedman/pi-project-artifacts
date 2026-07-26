# Markdown Docs Grooming Guidance

Use this guidance for `/cg-groom-docs` when improving project-local markdown artifacts under `${DOCS_ROOT}` and `${TODOS_ROOT}`.

## Goals

- Keep markdown human-readable and canonical.
- Improve search quality for `cg_search_artifacts` and raw `rg`.
- Preserve historical context; do not delete useful detail just because it is old.
- Make small, auditable edits.

## What to Inspect

Use `cg_search_artifacts` when available:

```text
cg_search_artifacts scopes=["docs","todos"] matchMode="any" minTermMatches=2 explain=true
cg_search_artifacts scopes=["todos"] status=["pending","ready"] rankProfile="todos" includeCompletedTodos=false
cg_search_artifacts scopes=["solutions"] rankProfile="frontmatter" includeBody=false
```

Use raw `rg` to verify exact strings, aliases, and body-only references:

```bash
rg -i --glob '*.md' 'term-a|term-b|ExactSymbol' "${DOCS_ROOT}" "${TODOS_ROOT}"
```

## Grooming Checks

### Titles

Good titles include the system, failure/decision, and searchable noun phrase.

Prefer:

```markdown
# Objective GUID dropdown saved empty target
```

Avoid:

```markdown
# Fix bug
```

### Tags and Frontmatter

Prefer specific tags that users are likely to search:

- `mission-teardown`
- `objective-modal`
- `ui-toolkit`
- `action-definition`
- `batchmode-screenshot`

Avoid relying only on broad tags:

- `runtime`
- `ui`
- `validation`
- `cleanup`

Broad tags are okay when paired with specific tags.

### Aliases

Add common aliases when names vary in the project:

- `actiondefinition`, `action-definition`
- `ui-toolkit`, `uitoolkit`
- `case-file`, `case file`
- exact package, API, asset, scene, or subsystem names

### Related Links

Add related docs when a search result depends on another artifact. Prefer explicit project-relative paths so `cg_search_artifacts includeRelated=true` can build a useful related-artifact graph:

```markdown
## Related Issues

- See also: docs/solutions/ui/example.md
- Related plan: docs/plans/YYYY-MM-DD-feature-example-plan.md
- Follow-up todo: todos/123-pending-p2-example.md
```

### Todos

Check filename/frontmatter consistency:

- filename status matches `status`
- filename priority matches `priority`
- legacy `status: completed` should be normalized to `status: complete` when editing the file
- `tags` include the affected system, not just `code-review`
- `dependencies` remain accurate

### Solutions

Check solution docs for:

- specific schema v2 `doc_type`, `category`, `failure_mode`, `module`, `component`, and `severity`
- focused `tags`
- no legacy `problem_type` in migrated Unity solution docs
- observable symptoms
- root cause and prevention guidance
- exact error text or API names where relevant
- related issues/plans/todos

### Unity Solution Schema Interaction

When grooming Unity solution docs:

- Use `skills/unity-docs/references/yaml-schema.md` and `skills/unity-docs/references/category-selection.md` via `cg_read_reference` if exact schema v2 values matter.
- Do not add legacy `problem_type` to new or edited schema v2 docs.
- Do not manually bulk-convert legacy `problem_type` docs as part of ordinary grooming. Use `/cg-migrate-unity-docs-schema` or `scripts/migrate-unity-docs-schema.ts` so moves, reports, and manual-review items are handled consistently.
- If editing a single legacy doc for another reason, either leave its legacy classification untouched and recommend migration, or convert that one doc to schema v2 only when the classification is obvious and the user approved metadata cleanup.
- After a bulk migration, use grooming for follow-up cleanup: verify related links, improve tags/aliases, inspect manual-review docs, and run `cg_search_artifacts` with `rebuild=true` if search results appear stale.
- Treat `docs/solutions/patterns/critical-patterns.md` as a schema v2 `doc_type: pattern`, `category: critical_patterns` aggregate file, not as a frontmatter-free exception.

## Edit Safety

Do:

- add missing searchable metadata
- normalize obvious status/tag inconsistencies
- add cross-references
- clarify titles/headings
- preserve solved-problem history

Do not:

- delete docs/todos during grooming
- rewrite technical conclusions without evidence
- convert markdown into generated-only formats
- cite the generated artifact index as evidence

## Reporting

Summarize:

- files changed
- metadata fields changed
- search terms/aliases added
- raw `rg` verification performed
- remaining docs that need manual review
