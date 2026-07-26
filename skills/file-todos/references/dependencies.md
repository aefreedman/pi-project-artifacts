# Dependency Management

## Declare Dependencies

```yaml
dependencies: ["002", "005"]
```

## Check Blockers

```bash
grep "^dependencies:" ${TODOS_ROOT}/003-*.md
```

## Find Dependents

```bash
grep -l 'dependencies:.*"002"' ${TODOS_ROOT}/*.md
```
