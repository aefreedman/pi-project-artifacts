import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { executeTodoLifecycle } from "../dist/core/index.js";

const context = (cwd) => ({ cwd, signal: new AbortController().signal });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "pi-todos-")); await mkdir(path.join(root, "todos")); return root; }
async function run(root, request, options) { return await executeTodoLifecycle(context(root), { workspaceRoot: root, ...request }, options); }
const canonical = (id, status, priority, title, body = "Body") => `---\nstatus: ${status}\npriority: ${priority}\nissue_id: ${id}\ntags: [fixture]\n---\n# ${title}\n\n${body}\n`;

test("create allocates under lock with exclusive writes and concurrent calls cannot collide", async () => {
  const root = await fixture();
  try {
    const allocation = await run(root, { operation: "allocate_id" });
    assert.equal(allocation.outcome, "allocated");
    assert.equal(allocation.renderedId, "001");
    const [one, two] = await Promise.all([
      run(root, { operation: "create", exclusive: true, todo: { title: "First task", priority: "p2", body: "## Problem Statement\n\nFirst" } }),
      run(root, { operation: "create", exclusive: true, todo: { title: "Second task", priority: "p1", status: "ready", body: "## Problem Statement\n\nSecond" } }),
    ]);
    assert.deepEqual([one.outcome, two.outcome], ["created", "created"]);
    assert.deepEqual([one.todo.issueId, two.todo.issueId].sort((a, b) => a - b), [1, 2]);
    const listed = await run(root, { operation: "list" });
    assert.equal(listed.todos.length, 2);
    assert.equal(listed.issues.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("expected directory hash and external content hash changes produce explicit conflicts", async () => {
  const root = await fixture();
  try {
    const allocation = await run(root, { operation: "allocate_id" });
    await writeFile(path.join(root, "todos", "001-pending-p2-external.md"), canonical(1, "pending", "p2", "External"));
    const staleCreate = await run(root, { operation: "create", exclusive: true, expectedDirectoryHash: allocation.directoryHash, todo: { title: "Stale", priority: "p2", body: "Body" } });
    assert.equal(staleCreate.outcome, "conflict");
    assert.equal(staleCreate.code, "directory_changed");

    const listed = await run(root, { operation: "list" });
    const todo = listed.todos[0];
    await writeFile(todo.path, canonical(1, "pending", "p2", "External", "changed externally"));
    const transition = await run(root, { operation: "transition", path: todo.path, toStatus: "complete", expectedContentHash: todo.contentHash });
    assert.equal(transition.outcome, "conflict");
    assert.equal(transition.code, "content_changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("transition changes only status text/path and rolls back injected failures", async () => {
  const root = await fixture();
  try {
    const source = path.join(root, "todos", "001-ready-p2-preserve-body.md");
    const original = canonical(1, "ready", "p2", "Preserve", "Unknown frontmatter and body bytes stay.\n");
    await writeFile(source, original);
    const listed = await run(root, { operation: "list" });
    const failed = await run(root, { operation: "transition", path: source, toStatus: "complete", expectedContentHash: listed.todos[0].contentHash }, {
      failureInjector(point) { if (point === "todo_transition_after_source_remove") throw new Error("injected transition failure"); },
    });
    assert.equal(failed.outcome, "blocked");
    assert.equal(await readFile(source, "utf8"), original);
    await assert.rejects(readFile(path.join(root, "todos", "001-complete-p2-preserve-body.md"), "utf8"), (error) => error.code === "ENOENT");

    const fresh = await run(root, { operation: "list" });
    const transitioned = await run(root, { operation: "transition", path: source, toStatus: "complete", expectedContentHash: fresh.todos[0].contentHash });
    assert.equal(transitioned.outcome, "transitioned");
    const next = await readFile(transitioned.todo.path, "utf8");
    assert.match(next, /^status: complete$/m);
    assert.match(next, /Unknown frontmatter and body bytes stay\.\n/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("pre-existing mismatches, malformed files, duplicate IDs, and collisions block without mutation", async () => {
  const root = await fixture();
  try {
    const conflictPath = path.join(root, "todos", "001-ready-p2-conflict.md");
    const original = canonical(2, "pending", "p2", "Conflict");
    await writeFile(conflictPath, original);
    await writeFile(path.join(root, "todos", "bad-name.md"), "# malformed\n");
    const listed = await run(root, { operation: "list" });
    assert.equal(listed.todos.length, 0);
    assert(listed.issues.some((issue) => issue.code === "issue_id_conflict"));
    assert(listed.issues.some((issue) => issue.code === "filename_invalid"));
    const created = await run(root, { operation: "create", exclusive: true, todo: { title: "Must block", priority: "p1", body: "Body" } });
    assert.equal(created.outcome, "conflict");
    assert.equal(created.code, "preexisting_todo_conflict");
    assert.equal(await readFile(conflictPath, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("duplicate numeric IDs and normalized case-fold path identities are diagnosed deterministically", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "todos", "001-pending-p2-one.md"), canonical(1, "pending", "p2", "One"));
    await writeFile(path.join(root, "todos", "001-ready-p1-two.md"), canonical(1, "ready", "p1", "Two"));
    const listed = await run(root, { operation: "list" });
    assert.equal(listed.todos.length, 0);
    assert.equal(listed.issues.filter((issue) => issue.code === "duplicate_issue_id").length, 2);
    const allocated = await run(root, { operation: "allocate_id" });
    assert.equal(allocated.outcome, "conflict");
    assert.equal(allocated.code, "preexisting_todo_conflict");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("create failure injection leaves no target/staging contradiction", async () => {
  const root = await fixture();
  try {
    const result = await run(root, { operation: "create", exclusive: true, todo: { title: "Injected create", priority: "p3", body: "Body" } }, {
      failureInjector(point) { if (point === "todo_create_after_target") throw new Error("injected create failure"); },
    });
    assert.equal(result.outcome, "blocked");
    const listed = await run(root, { operation: "list" });
    assert.deepEqual(listed.todos, []);
    assert.deepEqual(listed.issues, []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("hard-killed transitions resume deterministically from durable hashes", async () => {
  for (const failurePoint of ["todo_transition_after_target", "todo_transition_after_source_remove"]) {
    const root = await fixture();
    try {
      const source = path.join(root, "todos", "001-ready-p2-crash-resume.md");
      await writeFile(source, canonical(1, "ready", "p2", "Crash resume"));
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/todo-transition-child.mjs", import.meta.url)), root, failurePoint], { encoding: "utf8", windowsHide: true });
      assert.notEqual(child.status, 0, `child must be hard-killed at ${failurePoint}`);
      const allocation = await run(root, { operation: "allocate_id" });
      assert.equal(allocation.outcome, "allocated", `a subsequent locked mutation must recover ${failurePoint}`);
      const listed = await run(root, { operation: "list" });
      assert.equal(listed.issues.length, 0);
      assert.equal(listed.todos.length, 1);
      assert.equal(listed.todos[0].status, "complete");
      assert.equal(listed.todos[0].path, path.join(root, "todos", "001-complete-p2-crash-resume.md"));
      await assert.rejects(readFile(source), (error) => error.code === "ENOENT");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("request path containment rejects paths outside the todos root", async () => {
  const root = await fixture();
  try {
    await assert.rejects(run(root, { operation: "inspect", path: path.join(root, "outside", "001-pending-p2-task.md") }), /contained under todosRoot/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("todo roots stay within session cwd before lock/read/write and allow nested child workspaces", async () => {
  const coordination = await mkdtemp(path.join(tmpdir(), "pi-todos-coordination-"));
  const sibling = await fixture();
  try {
    const child = path.join(coordination, "child");
    await mkdir(path.join(child, "todos"), { recursive: true });
    const accepted = await executeTodoLifecycle(context(coordination), { operation: "allocate_id", workspaceRoot: child });
    assert.equal(accepted.outcome, "allocated");

    await assert.rejects(executeTodoLifecycle(context(coordination), { operation: "allocate_id", workspaceRoot: sibling }), (error) => error.code === "path_escape");
    await assert.rejects(executeTodoLifecycle(context(coordination), { operation: "allocate_id", workspaceRoot: path.dirname(coordination) }), (error) => error.code === "path_escape");
    assert.equal(existsSync(path.join(sibling, ".pi-project-artifacts")), false, "rejected sibling must not receive a todo lock");

    const junction = path.join(coordination, "junction-todos");
    await symlink(path.join(sibling, "todos"), junction, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(executeTodoLifecycle(context(coordination), { operation: "allocate_id", workspaceRoot: child, todosRoot: junction }), (error) => error.code === "path_escape");
  } finally {
    await rm(coordination, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  }
});
