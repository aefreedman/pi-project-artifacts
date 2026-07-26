# Protected Artifacts

This reference file documents Compound Game Dev pipeline artifacts that must never be flagged for deletion, removal, or gitignore.

---

## Protected Paths

<protected_artifacts>

The following physical artifact locations are Compound Game Dev pipeline artifacts
and must never be flagged for deletion, removal, or gitignore by any review agent,
triage process, or automated tool. Resolve physical roots via
./artifact-root-resolution.md.

### `${DOCS_ROOT}/plans/*.md`
- **Purpose:** Plan files created by `/cg-plan`
- **Nature:** Living documents that track implementation progress
- **Usage:** Checkboxes are checked off by `/cg-work` as tasks complete
- **Retention:** Permanent - these document the planning and execution history

### `${DOCS_ROOT}/solutions/*.md`
- **Purpose:** Solution documents created during problem-solving
- **Nature:** Institutional knowledge and documented fixes
- **Usage:** Referenced by future work to avoid repeating mistakes
- **Retention:** Permanent - these form the knowledge base

</protected_artifacts>

---

## Why These Are Protected

**Plans are living documents:**
- They track feature implementation progress
- Checked boxes show completed work
- Unchecked boxes show remaining tasks
- They serve as project documentation and audit trail

**Solutions are institutional memory:**
- Document problems encountered and their solutions
- Prevent repeating the same mistakes
- Provide searchable knowledge base
- Aid in onboarding and troubleshooting

---

## Detection and Filtering

**In code reviews:**
```bash
# Check if any finding targets protected artifacts
if grep -iE "(delete|remove|gitignore).*((^|[\\/])docs[\\/](plans|solutions)[\\/])" "$finding_file" &>/dev/null; then
  echo "⚠️ Skipping finding - targets protected pipeline artifacts"
  # Discard this finding during synthesis
  continue
fi
```

**In triage:**
```bash
# Check each todo for protected artifact violations
for todo_file in $READY_TODOS; do
  if grep -iE "(delete|remove|gitignore).*((^|[\\/])docs[\\/](plans|solutions)[\\/])" "$todo_file" &>/dev/null; then
    echo "⚠️ Skipping $todo_file - targets protected pipeline artifacts"
    # Mark as wont_fix or skip
    new_name=$(echo "$todo_file" | sed 's/-ready-/-wont_fix-/')
    mv "$todo_file" "$new_name"
  fi
done
```

**In automated cleanup tools:**
```bash
# Exclude protected paths from cleanup operations
CLEANUP_TARGETS=$(find "$DOCS_ROOT" -name "*.md" \
  ! -path "$DOCS_ROOT/plans/*" \
  ! -path "$DOCS_ROOT/solutions/*")
```

---

## What CAN Be Modified

**Allowed operations on protected artifacts:**
- ✅ Reading files (for reference)
- ✅ Checking off boxes in plans (updating progress)
- ✅ Adding new files to these directories
- ✅ Updating content (fixing typos, adding details)
- ✅ Cross-referencing from other documents

**Prohibited operations:**
- ❌ Deleting files from these directories
- ❌ Moving files out of these directories
- ❌ Adding these paths to .gitignore
- ❌ Recommending removal of these paths
- ❌ Flagging these as "cleanup needed"

---

## Usage in Skills

**Load this file when:**
- Performing code review synthesis
- Triaging todos for approval
- Running automated cleanup or linting
- Generating recommendations for file organization

Resolve `DOCS_ROOT` first when operating in coordination repos with multiple
workspaces.

**Reference this file:**
```markdown
Load protected artifacts list from ./protected-artifacts.md
```

Then filter findings to exclude any targeting these resolved physical paths.
