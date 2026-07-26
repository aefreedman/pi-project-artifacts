import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, realpath, rm, stat, unlink } from "node:fs/promises";
import * as path from "node:path";
import { assertTodoLifecycleRequestV1, parseCanonicalTodoBasenameV1, } from "../contracts/v1/index.js";
import { exclusiveWrite, fsyncDirectory, removeIfMatches, withDirectoryLock, withMutationQueue, writeJsonAtomic } from "./atomic.js";
import { ProjectArtifactError, throwIfAborted } from "./errors.js";
import { parseMarkdown, replaceTopLevelFrontmatterScalar, serializeFrontmatter } from "./markdown.js";
import { assertPhysicalContainment, collisionKey, isPathInside, normalizePath, physicalDirectory, resolveFrom, scopedPhysicalDirectory, scopedPhysicalDirectoryOrMissing } from "./roots.js";
export async function executeTodoLifecycle(context, request, options = {}) {
    assertTodoLifecycleRequestV1(request);
    throwIfAborted(context.signal);
    const roots = await resolveTodoRuntimeRoots(context.cwd, request.workspaceRoot, request.todosRoot, request.operation === "create");
    if (request.operation === "inspect")
        return await inspectOperation(roots.todosRoot, path.resolve(request.path));
    if (request.operation === "list") {
        const scan = await scanTodos(roots.todosRoot);
        return Object.freeze({ outcome: "listed", todos: Object.freeze(scan.todos), issues: Object.freeze(scan.issues) });
    }
    const lockPath = path.join(roots.workspaceRoot, ".pi-project-artifacts", `todo-v1-${shortHash(roots.todosRoot)}.lock`);
    await assertPhysicalContainment(roots.workspaceRoot, lockPath, "todo lock path");
    return await withMutationQueue(roots.todosRoot, async () => await withDirectoryLock(lockPath, lockOwner(roots.todosRoot), async () => {
        await recoverPendingTransitions(roots, context.signal);
        const scan = await scanTodos(roots.todosRoot);
        if (request.operation === "allocate_id")
            return allocateOperation(request.expectedDirectoryHash, scan);
        if (request.operation === "create")
            return await createOperation(context, request, roots, scan, options.failureInjector);
        return await transitionOperation(context, request, roots, scan, options.failureInjector);
    }, { signal: context.signal, physicalRoot: roots.workspaceRoot }));
}
async function resolveTodoRuntimeRoots(executionCwd, workspaceRaw, todosRaw, createTodos) {
    const physicalExecutionRoot = await physicalDirectory(path.resolve(executionCwd));
    const lexicalWorkspace = path.resolve(workspaceRaw);
    const workspaceRoot = await scopedPhysicalDirectory(physicalExecutionRoot, lexicalWorkspace, "workspaceRoot");
    const lexicalTodos = resolveFrom(lexicalWorkspace, todosRaw, "todos");
    let todosRoot = await scopedPhysicalDirectoryOrMissing(physicalExecutionRoot, lexicalTodos, "todosRoot");
    try {
        todosRoot = await scopedPhysicalDirectory(physicalExecutionRoot, todosRoot, "todosRoot");
    }
    catch (error) {
        if (!(error instanceof ProjectArtifactError) || error.code !== "root_missing")
            throw error;
        if (createTodos) {
            // Containment was established above before mkdir can touch the filesystem.
            await mkdir(todosRoot, { recursive: true });
            todosRoot = await scopedPhysicalDirectory(physicalExecutionRoot, todosRoot, "todosRoot");
        }
    }
    return { workspaceRoot, todosRoot };
}
async function inspectOperation(todosRoot, target) {
    await assertPhysicalContainment(todosRoot, target, "todo path");
    const inspected = await inspectTodoFile(target);
    return Object.freeze({
        outcome: "inspected",
        state: inspected.state,
        ...(inspected.todo === undefined ? {} : { todo: inspected.todo }),
        issues: Object.freeze(inspected.issues.map(({ code, summary }) => Object.freeze({ code, summary }))),
    });
}
function allocateOperation(expectedDirectoryHash, scan) {
    const blocker = preExistingConflict(scan);
    if (blocker)
        return blocker;
    if (expectedDirectoryHash !== undefined && expectedDirectoryHash !== scan.directoryHash)
        return conflict("directory_changed", "The todos directory changed after its expected hash was captured.");
    const issueId = Math.max(0, ...scan.todos.map((todo) => todo.issueId)) + 1;
    return Object.freeze({ outcome: "allocated", issueId, renderedId: renderId(issueId), directoryHash: scan.directoryHash });
}
async function createOperation(context, request, roots, scan, failureInjector) {
    const blocker = preExistingConflict(scan);
    if (blocker)
        return blocker;
    if (request.expectedDirectoryHash !== undefined && request.expectedDirectoryHash !== scan.directoryHash)
        return conflict("directory_changed", "The todos directory changed after its expected hash was captured.");
    const issueId = Math.max(0, ...scan.todos.map((todo) => todo.issueId)) + 1;
    if (!Number.isSafeInteger(issueId))
        return blocked("id_exhausted", "No safe numeric todo ID remains.");
    const renderedId = renderId(issueId);
    const status = request.todo.status ?? "pending";
    const slug = slugify(request.todo.title);
    if (slug === "")
        return blocked("description_invalid", "Todo title cannot produce a canonical filename description.");
    const target = path.join(roots.todosRoot, `${renderedId}-${status}-${request.todo.priority}-${slug}.md`);
    await assertPhysicalContainment(roots.todosRoot, target, "todo target");
    if ([...scan.todos, ...scan.issues.flatMap(() => [])].some((todo) => "path" in todo && typeof todo.path === "string" && collisionKey(todo.path) === collisionKey(target)))
        return conflict("path_collision", "The canonical todo target collides with an existing path.");
    const metadata = Object.assign(Object.create(null), request.todo.frontmatter ?? {});
    metadata.status = status;
    metadata.priority = request.todo.priority;
    metadata.issue_id = issueId;
    const body = normalizeTodoBody(request.todo.title, request.todo.body);
    const content = `---\n${serializeFrontmatter(metadata, ["status", "priority", "issue_id"])}\n---\n${body}`;
    return await withMutationQueue(target, async () => {
        const stageDirectory = path.join(roots.workspaceRoot, ".pi-project-artifacts", "staging");
        await assertPhysicalContainment(roots.workspaceRoot, stageDirectory, "todo staging directory");
        await mkdir(stageDirectory, { recursive: true });
        const stage = path.join(stageDirectory, `todo-create-${renderedId}-${shortHash(target)}.tmp`);
        let targetWritten = false;
        try {
            await failureInjector?.("todo_create_before_stage", { target });
            await assertPhysicalContainment(roots.workspaceRoot, stage, "todo stage path");
            await exclusiveWrite(stage, content);
            await failureInjector?.("todo_create_after_stage", { target, stage });
            await assertPhysicalContainment(roots.todosRoot, target, "todo target");
            await exclusiveWrite(target, content);
            targetWritten = true;
            await failureInjector?.("todo_create_after_target", { target });
            const todo = await identityFromWrittenFile(target);
            await unlink(stage).catch(() => undefined);
            return Object.freeze({ outcome: "created", todo });
        }
        catch (error) {
            if (targetWritten) {
                const removed = await removeIfMatches(target, content);
                if (!removed)
                    throw new ProjectArtifactError("rollback_conflict", `Create rollback refused to remove externally changed target: ${normalizePath(target)}`);
            }
            await unlink(stage).catch(() => undefined);
            if (hasCode(error, "EEXIST"))
                return conflict("target_exists", `Todo target already exists: ${normalizePath(target)}`);
            return blocked(error instanceof ProjectArtifactError ? error.code : "create_failed", error instanceof Error ? error.message : String(error));
        }
    });
}
async function transitionOperation(context, request, roots, scan, failureInjector) {
    const blocker = preExistingConflict(scan);
    if (blocker)
        return blocker;
    const source = path.resolve(request.path);
    await assertPhysicalContainment(roots.todosRoot, source, "todo source");
    const inspected = await inspectTodoFile(source);
    if (inspected.state !== "valid" || inspected.todo === undefined || inspected.text === undefined)
        return conflict("preexisting_todo_conflict", "The requested todo is not canonical and was left untouched.");
    const originalText = inspected.text;
    if (inspected.todo.contentHash !== request.expectedContentHash)
        return Object.freeze({ outcome: "conflict", code: "content_changed", summary: "Todo content changed after its expected hash was captured.", currentContentHash: inspected.todo.contentHash });
    const parsedName = parseCanonicalTodoBasenameV1(path.basename(source));
    const target = path.join(path.dirname(source), `${parsedName.renderedId}-${request.toStatus}-${parsedName.priority}-${parsedName.description}.md`);
    await assertPhysicalContainment(roots.todosRoot, target, "todo target");
    if (scan.todos.some((todo) => collisionKey(todo.path) === collisionKey(target) && collisionKey(todo.path) !== collisionKey(source)))
        return conflict("path_collision", `Transition target collides with an existing todo: ${normalizePath(target)}`);
    const nextContent = replaceTopLevelFrontmatterScalar(originalText, "status", parsedName.status, request.toStatus);
    return await withMutationQueue(source, async () => await withMutationQueue(target, async () => {
        const transitionRoot = transitionJournalRoot(roots.workspaceRoot);
        await assertPhysicalContainment(roots.workspaceRoot, transitionRoot, "todo transition journal root");
        await mkdir(transitionRoot, { recursive: true });
        const runDirectory = path.join(transitionRoot, `${shortHash(source)}-${randomUUID()}`);
        await assertPhysicalContainment(roots.workspaceRoot, runDirectory, "todo transition run directory");
        await mkdir(runDirectory);
        const sourceBackup = path.join(runDirectory, "source.original");
        const targetStage = path.join(runDirectory, "target.next");
        const sourceMode = (await stat(source)).mode;
        const journal = {
            schema: "@aefree/pi-project-artifacts/todo-transition-journal",
            version: 1,
            state: "prepared",
            source,
            target,
            sourceHash: request.expectedContentHash,
            targetHash: hashBytes(Buffer.from(nextContent)),
            sourceMode,
        };
        try {
            await assertPhysicalContainment(roots.workspaceRoot, sourceBackup, "todo transition backup");
            await exclusiveWrite(sourceBackup, originalText);
            await assertPhysicalContainment(roots.workspaceRoot, targetStage, "todo transition stage");
            await exclusiveWrite(targetStage, nextContent);
            await writeTransitionJournal(roots.workspaceRoot, runDirectory, journal, false);
            await failureInjector?.("todo_transition_after_stage", { source, target, runDirectory });
            await assertPhysicalContainment(roots.todosRoot, target, "todo target");
            await exclusiveWrite(target, nextContent);
            await chmod(target, sourceMode).catch((error) => { if (process.platform !== "win32")
                throw error; });
            await fsyncDirectory(path.dirname(target));
            journal.state = "target_written";
            await writeTransitionJournal(roots.workspaceRoot, runDirectory, journal, true);
            await failureInjector?.("todo_transition_after_target", { source, target, runDirectory });
            const currentHash = hashBytes(await readFile(source));
            if (currentHash !== request.expectedContentHash)
                throw new ProjectArtifactError("content_changed", "Todo changed immediately before source removal.");
            await assertPhysicalContainment(roots.todosRoot, source, "todo source");
            await unlink(source);
            await fsyncDirectory(path.dirname(source));
            journal.state = "source_removed";
            await writeTransitionJournal(roots.workspaceRoot, runDirectory, journal, true);
            await failureInjector?.("todo_transition_after_source_remove", { source, target, runDirectory });
            const todo = await identityFromWrittenFile(target);
            await rm(runDirectory, { recursive: true, force: true });
            return Object.freeze({ outcome: "transitioned", todo, previousPath: source });
        }
        catch (error) {
            try {
                await rollbackTransitionRun(roots, runDirectory, journal);
            }
            catch (restoreError) {
                throw new ProjectArtifactError("rollback_failed", `Transition rollback could not restore a hash-verified source: ${normalizePath(source)}`, { cause: restoreError instanceof Error ? restoreError.message : String(restoreError) });
            }
            if (hasCode(error, "EEXIST"))
                return conflict("target_exists", `Transition target already exists: ${normalizePath(target)}`);
            const current = await readFile(source).then(hashBytes).catch(() => undefined);
            return Object.freeze({ outcome: error instanceof ProjectArtifactError && error.code === "content_changed" ? "conflict" : "blocked", code: error instanceof ProjectArtifactError ? error.code : "transition_failed", summary: error instanceof Error ? error.message : String(error), ...(current === undefined ? {} : { currentContentHash: current }) });
        }
    }));
}
function transitionJournalRoot(workspaceRoot) {
    return path.join(workspaceRoot, ".pi-project-artifacts", "todo-transitions-v1");
}
async function writeTransitionJournal(workspaceRoot, runDirectory, journal, replace) {
    const journalPath = path.join(runDirectory, "journal.json");
    await assertPhysicalContainment(workspaceRoot, journalPath, "todo transition journal");
    await writeJsonAtomic(journalPath, journal, replace);
}
async function recoverPendingTransitions(roots, signal) {
    const journalRoot = transitionJournalRoot(roots.workspaceRoot);
    await assertPhysicalContainment(roots.workspaceRoot, journalRoot, "todo transition journal root");
    let entries;
    try {
        entries = await readdir(journalRoot, { withFileTypes: true });
    }
    catch (error) {
        if (hasCode(error, "ENOENT"))
            return;
        throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        throwIfAborted(signal);
        if (!entry.isDirectory() || entry.isSymbolicLink())
            throw new ProjectArtifactError("transition_journal_invalid", `Unexpected transition journal entry: ${normalizePath(path.join(journalRoot, entry.name))}`);
        const runDirectory = path.join(journalRoot, entry.name);
        const physicalRun = await realpath(runDirectory);
        await assertPhysicalContainment(roots.workspaceRoot, physicalRun, "todo transition run directory");
        const journal = validateTransitionJournal(JSON.parse(await readFile(path.join(physicalRun, "journal.json"), "utf8")));
        await recoverTransitionRun(roots, physicalRun, journal);
    }
}
function validateTransitionJournal(value) {
    const journal = value;
    if (!journal || journal.schema !== "@aefree/pi-project-artifacts/todo-transition-journal" || journal.version !== 1
        || !["prepared", "target_written", "source_removed"].includes(journal.state)
        || typeof journal.source !== "string" || typeof journal.target !== "string"
        || !/^sha256:[a-f0-9]{64}$/u.test(journal.sourceHash) || !/^sha256:[a-f0-9]{64}$/u.test(journal.targetHash)
        || !Number.isSafeInteger(journal.sourceMode)) {
        throw new ProjectArtifactError("transition_journal_invalid", "Todo transition journal is malformed or has an inadmissible state.");
    }
    return journal;
}
async function recoverTransitionRun(roots, runDirectory, journal) {
    await assertPhysicalContainment(roots.todosRoot, journal.source, "todo transition source");
    await assertPhysicalContainment(roots.todosRoot, journal.target, "todo transition target");
    const backup = path.join(runDirectory, "source.original");
    const stage = path.join(runDirectory, "target.next");
    await assertPhysicalContainment(roots.workspaceRoot, backup, "todo transition backup");
    await assertPhysicalContainment(roots.workspaceRoot, stage, "todo transition stage");
    if (await fileDigest(backup) !== journal.sourceHash || await fileDigest(stage) !== journal.targetHash) {
        throw new ProjectArtifactError("transition_journal_hash_mismatch", `Todo transition recovery files changed: ${normalizePath(runDirectory)}`);
    }
    const sourceHash = await fileDigest(journal.source);
    const targetHash = await fileDigest(journal.target);
    if (sourceHash === journal.sourceHash && targetHash === undefined) {
        // No destination was durably published: the deterministic outcome is rollback.
        await rm(runDirectory, { recursive: true, force: true });
        return;
    }
    if (sourceHash === journal.sourceHash && targetHash === journal.targetHash) {
        // A published destination commits the transition. Resume the remaining remove.
        await assertPhysicalContainment(roots.todosRoot, journal.source, "todo transition source");
        await unlink(journal.source);
        await fsyncDirectory(path.dirname(journal.source));
        await rm(runDirectory, { recursive: true, force: true });
        return;
    }
    if (sourceHash === undefined && targetHash === journal.targetHash) {
        await rm(runDirectory, { recursive: true, force: true });
        return;
    }
    if (sourceHash === undefined && targetHash === undefined) {
        const original = await readFile(backup);
        await assertPhysicalContainment(roots.todosRoot, journal.source, "todo transition source");
        await exclusiveWrite(journal.source, original);
        await chmod(journal.source, journal.sourceMode).catch((error) => { if (process.platform !== "win32")
            throw error; });
        await fsyncDirectory(path.dirname(journal.source));
        await rm(runDirectory, { recursive: true, force: true });
        return;
    }
    throw new ProjectArtifactError("transition_recovery_conflict", `Todo transition recovery refused hash-conflicting files: ${normalizePath(runDirectory)}`, { sourceHash, targetHash });
}
async function rollbackTransitionRun(roots, runDirectory, journal) {
    const targetHash = await fileDigest(journal.target);
    if (targetHash !== undefined && targetHash !== journal.targetHash)
        throw new ProjectArtifactError("rollback_conflict", `Transition rollback refused externally changed target: ${normalizePath(journal.target)}`);
    if (targetHash === journal.targetHash) {
        await assertPhysicalContainment(roots.todosRoot, journal.target, "todo transition target");
        await unlink(journal.target);
        await fsyncDirectory(path.dirname(journal.target));
    }
    const sourceHash = await fileDigest(journal.source);
    if (sourceHash !== undefined && sourceHash !== journal.sourceHash)
        throw new ProjectArtifactError("rollback_conflict", `Transition rollback refused externally changed source: ${normalizePath(journal.source)}`);
    if (sourceHash === undefined) {
        const backup = path.join(runDirectory, "source.original");
        if (await fileDigest(backup) !== journal.sourceHash)
            throw new ProjectArtifactError("rollback_backup_invalid", `Transition source backup is unavailable: ${normalizePath(backup)}`);
        await assertPhysicalContainment(roots.todosRoot, journal.source, "todo transition source");
        await exclusiveWrite(journal.source, await readFile(backup));
        await chmod(journal.source, journal.sourceMode).catch((error) => { if (process.platform !== "win32")
            throw error; });
        await fsyncDirectory(path.dirname(journal.source));
    }
    await assertPhysicalContainment(roots.workspaceRoot, runDirectory, "todo transition run directory");
    await rm(runDirectory, { recursive: true, force: true });
}
async function fileDigest(file) {
    try {
        return hashBytes(await readFile(file));
    }
    catch (error) {
        if (hasCode(error, "ENOENT"))
            return undefined;
        throw error;
    }
}
async function scanTodos(todosRoot) {
    let files = [];
    try {
        files = await listTodoMarkdown(todosRoot);
    }
    catch (error) {
        if (!hasCode(error, "ENOENT"))
            throw error;
    }
    const inspections = await Promise.all(files.map(async (file) => ({ path: file, inspected: await inspectTodoFile(file) })));
    const todos = [];
    const issues = [];
    for (const { path: file, inspected } of inspections) {
        if (inspected.state === "valid" && inspected.todo !== undefined)
            todos.push(inspected.todo);
        else
            for (const issue of inspected.issues)
                issues.push({ path: file, code: issue.code, summary: issue.summary });
    }
    const duplicates = new Map();
    const collisions = new Map();
    for (const todo of todos) {
        (duplicates.get(todo.issueId) ?? (duplicates.set(todo.issueId, []), duplicates.get(todo.issueId))).push(todo);
        const key = collisionKey(todo.path);
        (collisions.get(key) ?? (collisions.set(key, []), collisions.get(key))).push(todo);
    }
    const excluded = new Set();
    for (const [id, matches] of duplicates)
        if (matches.length > 1)
            for (const todo of matches) {
                excluded.add(todo.path);
                issues.push({ path: todo.path, code: "duplicate_issue_id", summary: `Todo issue ID ${id} is duplicated; canonical tools will not choose an authority.` });
            }
    for (const matches of collisions.values())
        if (matches.length > 1)
            for (const todo of matches) {
                excluded.add(todo.path);
                issues.push({ path: todo.path, code: "path_collision", summary: "Todo path has a normalization/case-fold collision." });
            }
    const valid = todos.filter((todo) => !excluded.has(todo.path)).sort((left, right) => left.issueId - right.issueId || left.path.localeCompare(right.path));
    return { todos: valid, issues: issues.sort((left, right) => (left.path ?? "").localeCompare(right.path ?? "") || left.code.localeCompare(right.code)), directoryHash: await directoryHash(todosRoot), rootExists: true };
}
export async function inspectTodoFile(file) {
    let bytes;
    try {
        const physical = await realpath(file);
        if (collisionKey(physical) !== collisionKey(file))
            return { state: "invalid", issues: [{ code: "symlink_todo", summary: "Todo files may not be symlinks or junction aliases." }] };
        bytes = await readFile(physical);
    }
    catch (error) {
        return { state: "invalid", issues: [{ code: hasCode(error, "ENOENT") ? "todo_missing" : "todo_unreadable", summary: hasCode(error, "ENOENT") ? "Todo file does not exist." : "Todo file could not be read." }] };
    }
    let filename;
    try {
        filename = parseCanonicalTodoBasenameV1(path.basename(file));
    }
    catch {
        return { state: "invalid", issues: [{ code: "filename_invalid", summary: "Todo filename is not canonical." }], text: bytes.toString("utf8") };
    }
    const text = bytes.toString("utf8");
    const parsed = parseMarkdown(text);
    const issues = [];
    if (parsed.rawFrontmatter === undefined || parsed.malformed)
        issues.push({ code: "frontmatter_invalid", summary: "Todo frontmatter is missing, unterminated, or malformed." });
    const issueId = numericId(parsed.frontmatter.issue_id);
    const status = scalar(parsed.frontmatter.status);
    const priority = scalar(parsed.frontmatter.priority);
    const validFrontmatterId = issueId !== undefined;
    const validFrontmatterStatus = status === "pending" || status === "ready" || status === "complete";
    const validFrontmatterPriority = priority === "p1" || priority === "p2" || priority === "p3";
    if (!validFrontmatterId)
        issues.push({ code: "frontmatter_issue_id_invalid", summary: "Todo frontmatter issue_id must be a positive decimal identity." });
    if (!validFrontmatterStatus)
        issues.push({ code: status === "completed" ? "frontmatter_status_legacy" : "frontmatter_status_invalid", summary: status === "completed" ? "Legacy completed status is non-canonical; consuming projects own reconciliation." : "Todo frontmatter status is invalid." });
    if (!validFrontmatterPriority)
        issues.push({ code: "frontmatter_priority_invalid", summary: "Todo frontmatter priority is invalid." });
    let conflictFound = false;
    if (validFrontmatterId && issueId !== filename.issueId) {
        conflictFound = true;
        issues.push({ code: "issue_id_conflict", summary: "Filename and frontmatter contain different valid issue IDs." });
    }
    if (validFrontmatterStatus && status !== filename.status) {
        conflictFound = true;
        issues.push({ code: "status_conflict", summary: "Filename and frontmatter contain different valid statuses." });
    }
    if (validFrontmatterPriority && priority !== filename.priority) {
        conflictFound = true;
        issues.push({ code: "priority_conflict", summary: "Filename and frontmatter contain different valid priorities." });
    }
    if (issues.length > 0)
        return { state: conflictFound ? "conflict" : "invalid", issues, text };
    const todo = Object.freeze({ issueId: filename.issueId, renderedId: filename.renderedId, status: filename.status, priority: filename.priority, path: path.resolve(file), contentHash: hashBytes(bytes) });
    return { state: "valid", todo, issues: [], text };
}
async function identityFromWrittenFile(file) {
    const inspected = await inspectTodoFile(file);
    if (inspected.state !== "valid" || inspected.todo === undefined)
        throw new ProjectArtifactError("post_write_invalid", `Written todo failed canonical validation: ${normalizePath(file)}`);
    return inspected.todo;
}
function preExistingConflict(scan) {
    if (scan.issues.length === 0)
        return undefined;
    const first = scan.issues[0];
    return conflict("preexisting_todo_conflict", `Pre-existing todo conflict blocks mutation without repair: ${first.path ? `${normalizePath(first.path)}: ` : ""}${first.code} — ${first.summary}`);
}
async function listTodoMarkdown(root) {
    const physicalRoot = await physicalDirectory(root);
    const output = [];
    const stack = [physicalRoot];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = await readdir(current, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (entry.isSymbolicLink()) {
                if (entry.name.toLowerCase().endsWith(".md"))
                    output.push(path.join(current, entry.name));
                continue;
            }
            const child = path.join(current, entry.name);
            if (entry.isDirectory())
                stack.push(child);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
                const physical = await realpath(child);
                if (!isPathInside(physicalRoot, physical))
                    throw new ProjectArtifactError("path_escape", `Todo escaped its physical root: ${normalizePath(child)}`);
                output.push(physical);
            }
        }
    }
    return output.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}
async function directoryHash(root) {
    let entries;
    try {
        entries = await listDirectoryEntries(root);
    }
    catch (error) {
        if (hasCode(error, "ENOENT"))
            entries = [];
        else
            throw error;
    }
    return `sha256:${createHash("sha256").update(entries.join("\n")).digest("hex")}`;
}
async function listDirectoryEntries(root) {
    const output = [];
    const stack = [root];
    while (stack.length > 0) {
        const current = stack.pop();
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const child = path.join(current, entry.name);
            const relative = normalizePath(path.relative(root, child));
            if (entry.isSymbolicLink())
                output.push(`symlink\0${relative}`);
            else if (entry.isDirectory()) {
                output.push(`dir\0${relative}`);
                stack.push(child);
            }
            else if (entry.isFile())
                output.push(`file\0${relative}\0${hashBytes(await readFile(child))}`);
            else
                output.push(`other\0${relative}`);
        }
    }
    return output.sort();
}
function normalizeTodoBody(title, body) {
    const normalized = body.replace(/^\uFEFF/u, "");
    if (/^#\s+/mu.test(normalized))
        return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    const prefix = `# ${title.trim()}\n\n`;
    const text = `${prefix}${normalized.replace(/^\s+/u, "")}`;
    return text.endsWith("\n") ? text : `${text}\n`;
}
function slugify(value) { return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80).replace(/-+$/u, ""); }
function scalar(value) { return typeof value === "string" ? value.trim().replace(/^['"]|['"]$/gu, "") : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined; }
function numericId(value) { const text = scalar(value); if (text === undefined || !/^\d+$/u.test(text))
    return undefined; const number = Number(text); return Number.isSafeInteger(number) && number > 0 ? number : undefined; }
function renderId(issueId) { return String(issueId).padStart(3, "0"); }
function shortHash(value) { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function hashBytes(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function lockOwner(todosRoot) { return Object.freeze({ schema: "@aefree/pi-project-artifacts/lock", version: 1, owner: "todo-lifecycle", pid: process.pid, createdAt: new Date().toISOString(), todosRootHash: shortHash(todosRoot) }); }
function conflict(code, summary) { return Object.freeze({ outcome: "conflict", code, summary }); }
function blocked(code, summary) { return Object.freeze({ outcome: "blocked", code, summary }); }
function hasCode(error, code) { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
//# sourceMappingURL=todo-lifecycle.js.map