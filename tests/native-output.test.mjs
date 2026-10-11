import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Check } from "typebox/value";
import register, { TOOL_OUTPUT_SCHEMAS_V1, NATIVE_OUTPUT_BYTES_V1, PRESENTATION_BYTES_V1, DETAILS_BYTES_V1 } from "../dist/pi/index.js";
import { executeTodoLifecycle } from "../dist/core/index.js";
import { createArtifactProfileRegistryV1 } from "../dist/contracts/v1/index.js";
import { nativeToolResult } from "../dist/pi/native-output.js";
import { executeArtifactSearch } from "../dist/core/artifact-search.js";
import { attachObservations, newObservations } from "../dist/core/operation-observations.js";

const hash = text => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const markdown = (id, status = "ready") => `---\nissue_id: ${id}\nstatus: ${status}\npriority: p2\n---\n# Task\n`;
const context = cwd => ({ cwd, signal: new AbortController().signal });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), "artifacts-native-")); await mkdir(path.join(root, "docs")); await mkdir(path.join(root, "todos")); return root; }
async function adapter(root) {
  const tools = new Map(), handlers = new Map();
  register({ registerTool: tool => tools.set(tool.name, tool), on: (name, handler) => handlers.set(name, handler), events: { emit() {} } });
  const ctx = { cwd: root, sessionManager: {} };
  await handlers.get("session_start")({}, ctx);
  return { tools, scope: ctx.sessionManager, async call(name, args = {}) { const result = await tools.get(name).execute(name, args, new AbortController().signal, undefined, ctx); assert(Check(tools.get(name).outputSchema, result.structuredContent), JSON.stringify(result)); return result; }, async close() { await handlers.get("session_shutdown")({}, ctx); } };
}
async function nativeTodo(root, name, request, options) {
  return nativeToolResult(name, async () => {
    const native = await executeTodoLifecycle(context(root), { workspaceRoot: root, ...request }, options);
    return { native, text: JSON.stringify(native), details: { result: native } };
  }, { ...(request.expectedDirectoryHash ? { expectedDirectoryHash: request.expectedDirectoryHash } : {}), ...(request.expectedContentHash ? { expectedContentHash: request.expectedContentHash } : {}) });
}

test("all eight real registered adapters publish useful closed native contracts with exact hashes and successful findings", async () => {
  const root = await fixture(); const host = await adapter(root);
  try {
    assert.equal(host.tools.size, 8);
    await writeFile(path.join(root, "docs", "note.md"), "---\ncustom_flag: false\ncustom_count: 0\ncustom_empty: null\n---\n# Note\n" + "x".repeat(1250) + " hiddenneedle\n");
    const search = await host.call("project_artifact_search", { filters: { custom_flag: "false", custom_count: "0" }, freshnessMode: "strict" });
    assert.equal(search.structuredContent.ok, true);
    assert.equal(Check(host.tools.get("project_artifact_search").outputSchema, { ...search.structuredContent, unexpected: "not admitted" }), false);
    assert.equal(Check(host.tools.get("project_artifact_search").outputSchema, { ...search.structuredContent, data: undefined }), false);
    assert.equal(search.structuredContent.data.results[0].path, "docs/note.md");
    assert(search.structuredContent.data.results[0].filterSemantics.items.every(item => item.confidence === "raw_exact"));
    assert.equal(search.structuredContent.effects.cacheEffects, "observed");
    assert.equal(search.structuredContent.effects.documentEffects, "none");
    assert.equal(search.structuredContent.completeness.bodyPreviewCharacters, 1200);
    assert.match(search.content[0].text, /docs\/note.md/);
    const missed = await host.call("project_artifact_search", { query: "hiddenneedle", searchFields: ["body"], freshnessMode: "strict" });
    assert.equal(missed.structuredContent.data.results.length, 0);
    assert.equal(missed.structuredContent.completeness.sourceCoverage, "preview_only");
    const describe = await host.call("project_artifact_describe", { outputMode: "detailed", includeSamples: true, fieldNames: ["custom_flag", "custom_count", "custom_empty"] });
    const observed = describe.structuredContent.data.observedFields;
    assert.deepEqual(observed.find(field => field.name === "custom_flag").sampleValues, ["false"]);
    assert.deepEqual(observed.find(field => field.name === "custom_count").sampleValues, ["0"]);
    assert(observed.find(field => field.name === "custom_empty").inferredPrimitiveTypes.includes("null"));
    assert.equal(describe.structuredContent.data.fields.find(field => field.name === "status").required, false);
    const allocated = await host.call("project_todo_allocate");
    assert.equal(allocated.structuredContent.data.reservation, false);
    const created = await host.call("project_todo_create", { title: "Task", priority: "p2", body: "Body", expectedDirectoryHash: allocated.structuredContent.data.directoryHash });
    const todo = created.structuredContent.data.todo;
    assert.equal(created.structuredContent.ok, true);
    assert.equal(created.structuredContent.effects.documentEffects, "observed");
    assert.equal(todo.contentHash, hash(await readFile(todo.path)));
    const inspected = await host.call("project_todo_inspect", { path: todo.path });
    assert.deepEqual(inspected.structuredContent.data.todo, todo);
    const transitioned = await host.call("project_todo_transition", { path: todo.path, toStatus: "complete", expectedContentHash: todo.contentHash });
    assert.equal(transitioned.structuredContent.data.previousPath, todo.path);
    assert.equal(transitioned.structuredContent.preconditions.expectedContentHash, todo.contentHash);
    assert.equal(transitioned.structuredContent.data.todo.contentHash, hash(await readFile(transitioned.structuredContent.data.todo.path)));
    const changed = await host.call("project_todo_transition", { path: transitioned.structuredContent.data.todo.path, toStatus: "ready", expectedContentHash: todo.contentHash });
    assert.equal(changed.isError, true); assert.equal(changed.structuredContent.error.code, "content_changed");
    assert.equal(changed.structuredContent.currentContentHash, transitioned.structuredContent.data.todo.contentHash);
    assert.equal(changed.structuredContent.preconditions.expectedContentHash, todo.contentHash);
    await writeFile(path.join(root, "todos", "bad.md"), "malformed");
    for (const name of ["project_todo_validate", "project_todo_list"]) {
      const result = await host.call(name);
      assert.equal(result.structuredContent.operation, name);
      assert.equal(result.structuredContent.ok, true);
      assert.equal(result.isError, undefined);
      assert(result.structuredContent.data.issues.length > 0);
      assert.match(result.content[0].text, /filename_invalid/);
    }
    await writeFile(path.join(root, "todos", "002-ready-p2-invalid.md"), "malformed");
    const invalid = await host.call("project_todo_inspect", { path: path.join(root, "todos", "002-ready-p2-invalid.md") });
    assert.equal(invalid.structuredContent.ok, true);
    assert.equal(invalid.structuredContent.data.state, "invalid");
    for (const [name, args] of [["project_todo_allocate", {}], ["project_todo_create", { title: "Blocked", priority: "p2", body: "Body" }], ["project_todo_transition", { path: transitioned.structuredContent.data.todo.path, toStatus: "ready", expectedContentHash: todo.contentHash }]]) {
      const result = await host.call(name, args);
      assert.equal(result.isError, true); assert.equal(result.structuredContent.ok, false);
    }
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test("large scans/catalogs preserve totals and bound independent content/details/native channels", async () => {
  const root = await fixture(); const host = await adapter(root);
  try {
    for (let id = 1; id <= 125; id++) await writeFile(path.join(root, "todos", `${String(id).padStart(3, "0")}-ready-p2-task.md`), markdown(id));
    for (let id = 0; id < 110; id++) await writeFile(path.join(root, "todos", `bad-${id}.md`), "bad");
    const result = await host.call("project_todo_list");
    assert.deepEqual(result.structuredContent.completeness.rows, { total: 125, returned: 100, omitted: 25 });
    assert.deepEqual(result.structuredContent.completeness.issues, { total: 110, returned: 100, omitted: 10 });
    assert(Buffer.byteLength(result.content.map(block => block.text).join("")) <= PRESENTATION_BYTES_V1);
    assert(Buffer.byteLength(JSON.stringify(result.details)) <= DETAILS_BYTES_V1);
    assert(Buffer.byteLength(JSON.stringify(result.structuredContent)) <= NATIVE_OUTPUT_BYTES_V1);
    const metadata = Array.from({ length: 140 }, (_, id) => `dynamic_${id}: value_${id}`).join("\n");
    await writeFile(path.join(root, "docs", "many.md"), `---\n${metadata}\ncredential: private-secret\n---\n# Many\n`);
    const described = await host.call("project_artifact_describe", { freshnessMode: "strict" });
    assert.equal(described.structuredContent.data.observedFields.length, 100);
    assert(described.structuredContent.completeness.rows.omitted > 0);
    assert.equal(JSON.stringify(described.structuredContent).includes("private-secret"), false);
    assert(described.structuredContent.data.observedFields.every(field => field.sampleValues === undefined));
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test("same-operation journal recovery effects survive allocation refusal with no extra recovery or replay", async () => {
  const root = await fixture();
  try {
    const source = path.join(root, "todos", "001-ready-p2-task.md"), target = path.join(root, "todos", "001-complete-p2-task.md");
    const original = markdown(1), next = markdown(1, "complete");
    await writeFile(source, original); await writeFile(target, next);
    const run = path.join(root, ".pi-project-artifacts", "todo-transitions-v1", "fixture"); await mkdir(run, { recursive: true });
    await writeFile(path.join(run, "source.original"), original); await writeFile(path.join(run, "target.next"), next);
    await writeFile(path.join(run, "journal.json"), JSON.stringify({ schema: "@aefree/pi-project-artifacts/todo-transition-journal", version: 1, state: "target_written", source, target, sourceHash: hash(original), targetHash: hash(next), sourceMode: 0o644 }));
    const result = await nativeTodo(root, "project_todo_allocate", { operation: "allocate_id", expectedDirectoryHash: hash("stale") });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, "directory_changed");
    const effects = result.structuredContent.effects;
    assert.match(result.content.map(block => block.text).join(" "), /documents=observed/);
    assert.equal(effects.recoveryStarted, 1); assert.equal(effects.recoveryCompleted, 1); assert.equal(effects.documentEffects, "observed");
    assert.deepEqual(effects.references, [source, target]); assert.match(effects.directoryHash, /^sha256:/);
    assert.equal(effects.recoveryEntries[0].sourceHash, hash(original));
    assert.equal(effects.recoveryEntries[0].targetHash, hash(next));
    assert.equal(effects.recoveryEntries[0].currentSourceHash, hash(original));
    assert.equal(effects.recoveryEntries[0].currentTargetHash, hash(next));
    assert.equal(effects.recoveryEntries[0].action, "removed_source");
    assert.equal(effects.recoveryEntries[0].outcome, "completed");
    await assert.rejects(readFile(source), { code: "ENOENT" }); assert.equal(await readFile(target, "utf8"), next);
    const again = await nativeTodo(root, "project_todo_allocate", { operation: "allocate_id" });
    assert.equal(again.structuredContent.effects.recoveryStarted, 0);
    assert.equal(again.structuredContent.data.issueId, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("post-target failures, completed and refused rollback, and projection failure retain conservative effects", async () => {
  const root = await fixture();
  try {
    let stages = 0;
    const failed = await nativeTodo(root, "project_todo_create", { operation: "create", exclusive: true, todo: { title: "Rollback", priority: "p2", body: "Body" } }, { failureInjector(point) { stages++; if (point === "todo_create_after_target") throw new Error("private credential: do-not-expose"); } });
    assert.equal(stages, 3); assert.equal(failed.structuredContent.ok, false); assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.effects.rollback, "completed"); assert.equal(failed.structuredContent.effects.documentEffects, "observed");
    assert.equal(JSON.stringify(failed.structuredContent).includes("do-not-expose"), false);
    const refused = await nativeTodo(root, "project_todo_create", { operation: "create", exclusive: true, todo: { title: "Refused", priority: "p2", body: "Body" } }, { async failureInjector(point, facts) { if (point === "todo_create_after_target") { await writeFile(facts.target, "external"); throw new Error("injected"); } } });
    assert.equal(refused.structuredContent.effects.rollback, "failed"); assert.equal(refused.structuredContent.effects.documentEffects, "possible"); assert.equal(refused.structuredContent.error.code, "rollback_conflict");
    await rm(refused.structuredContent.effects.references[0]);
    const created = await executeTodoLifecycle(context(root), { operation: "create", workspaceRoot: root, exclusive: true, todo: { title: "Projection", priority: "p2", body: "Body" } });
    let calls = 0;
    const projected = await nativeToolResult("project_todo_transition", async () => { calls++; return { native: created, text: "Created", details: {} }; });
    assert.equal(calls, 1); assert.equal(projected.structuredContent.error.code, "output_contract_error"); assert.equal(projected.structuredContent.effects.documentEffects, "observed");
    const source = created.todo.path;
    const rolledBack = await nativeTodo(root, "project_todo_transition", { operation: "transition", path: source, toStatus: "complete", expectedContentHash: created.todo.contentHash }, { failureInjector(point) { if (point === "todo_transition_after_source_remove") throw new Error("injected"); } });
    assert.equal(rolledBack.structuredContent.effects.rollback, "completed"); assert.equal(rolledBack.structuredContent.effects.documentEffects, "observed");
    assert.equal(hash(await readFile(source)), created.todo.contentHash);
    const uncertain = await nativeTodo(root, "project_todo_transition", { operation: "transition", path: source, toStatus: "complete", expectedContentHash: created.todo.contentHash }, { async failureInjector(point, facts) { if (point === "todo_transition_after_target") { await writeFile(facts.target, "external"); throw new Error("injected"); } } });
    assert.equal(uncertain.structuredContent.effects.rollback, "failed"); assert.equal(uncertain.structuredContent.effects.documentEffects, "possible"); assert.equal(uncertain.structuredContent.error.code, "rollback_failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only admitted identities are guarded; UTF-8 overflow fails safely after cache effects", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "docs", "a.md"), "# Fixture\n");
    const native = await executeArtifactSearch(context(root), {}, { outcome: "missing", providerIds: [] });
    const project = (result) => nativeToolResult("project_artifact_search", async () => ({ native: result, text: result.text, details: result.details }));
    const row = native.details.results[0];
    const exactBoundary = { ...native, details: { ...native.details, results: [{ ...row, path: "p".repeat(4096), title: "t".repeat(400), unused: { path: "x".repeat(9000) } }] } };
    const exactResult = await project(exactBoundary);
    assert.equal(exactResult.structuredContent.ok, true); assert.equal(exactResult.structuredContent.data.results[0].path.length, 4096); assert.equal(exactResult.structuredContent.completeness.descriptionsClipped, 1);
    assert.equal(exactResult.structuredContent.effects.documentEffects, "unknown");
    assert.equal(exactResult.structuredContent.effects.recoveryStarted, null);
    assert.equal(exactResult.structuredContent.effects.rollback, "unknown");
    const tooLong = await project({ ...native, details: { ...native.details, results: [{ ...row, related: [{ path: "x".repeat(4097), kind: row.kind, relation: "linksTo" }] }] } });
    assert.equal(tooLong.structuredContent.error.code, "output_contract_error");
    const omittedRow = { ...row, path: "x".repeat(4097) };
    const ignored = await project({ ...native, details: { ...native.details, resultCount: 101, results: [...Array(100).fill(row), omittedRow] } });
    assert.equal(ignored.structuredContent.ok, true); assert.equal(ignored.structuredContent.completeness.rows.omitted, 1);
    // Keep original producer object so cache-effect evidence cannot be lost through a synthetic clone.
    const captured = await executeArtifactSearch(context(root), { rebuild: true }, { outcome: "missing", providerIds: [] });
    const large = await nativeToolResult("project_artifact_search", async () => { captured.details.results[0]; return { native: captured, text: "Unicode 🔎 ".repeat(10000), details: { ...captured.details, extra: "x".repeat(100000) } }; });
    assert.equal(large.structuredContent.ok, true); assert(Buffer.byteLength(large.content.map(block => block.text).join("")) <= PRESENTATION_BYTES_V1); assert(Buffer.byteLength(JSON.stringify(large.details)) <= DETAILS_BYTES_V1);
    const overflow = await project({ ...native, details: { ...native.details, resultCount: 100, results: Array.from({ length: 100 }, () => ({ ...row, snippet: "🔎".repeat(500) })) } });
    assert.equal(overflow.isError, true); assert.equal(overflow.structuredContent.error.code, "output_contract_error");
    assert(Check(TOOL_OUTPUT_SCHEMAS_V1.project_artifact_search, overflow.structuredContent));
    for (let id = 0; id < 100; id++) await writeFile(path.join(root, "docs", `large-${id}.md`), "# Large\nneedle " + "🔎".repeat(800));
    const capturedOverflow = await executeArtifactSearch(context(root), { query: "needle", maxSnippetChars: 1000, limit: 100, freshnessMode: "strict" }, { outcome: "missing", providerIds: [] });
    assert.equal(capturedOverflow.details.results.length, 100);
    const producerOverflow = await project(capturedOverflow);
    assert.equal(producerOverflow.structuredContent.error.code, "output_contract_error");
    assert.equal(producerOverflow.structuredContent.effects.cacheEffects, "observed");
    const cycle = {}; cycle.self = cycle;
    const channelFailure = await nativeToolResult("project_artifact_search", async () => ({ native: captured, text: "Fixture", details: cycle }));
    assert.equal(channelFailure.structuredContent.error.code, "output_contract_error");
    assert.equal(channelFailure.structuredContent.effects.cacheEffects, "observed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recovery failure retains earlier committed recovery and bounded exact reconciliation hashes", async () => {
  const root = await fixture();
  try {
    const sources = [];
    for (let id = 1; id <= 2; id++) {
      const source = path.join(root, "todos", `${String(id).padStart(3, "0")}-ready-p2-task.md`), target = source.replace("-ready-", "-complete-"); sources.push(source);
      const original = markdown(id), next = markdown(id, "complete");
      await writeFile(source, id === 1 ? original : "external conflict"); await writeFile(target, next);
      const run = path.join(root, ".pi-project-artifacts", "todo-transitions-v1", `fixture-${id}`); await mkdir(run, { recursive: true });
      await writeFile(path.join(run, "source.original"), original); await writeFile(path.join(run, "target.next"), next);
      await writeFile(path.join(run, "journal.json"), JSON.stringify({ schema: "@aefree/pi-project-artifacts/todo-transition-journal", version: 1, state: "target_written", source, target, sourceHash: hash(original), targetHash: hash(next), sourceMode: 0o644 }));
    }
    const failed = await nativeTodo(root, "project_todo_allocate", { operation: "allocate_id" });
    assert.equal(failed.isError, true); assert.equal(failed.structuredContent.error.code, "transition_recovery_conflict");
    assert.equal(failed.structuredContent.effects.recoveryStarted, 2); assert.equal(failed.structuredContent.effects.recoveryCompleted, 1);
    assert.equal(failed.structuredContent.effects.documentEffects, "observed");
    assert.deepEqual(failed.structuredContent.effects.recoveryEntries.map(entry => entry.outcome), ["completed", "failed"]);
    assert.equal(failed.structuredContent.effects.recoveryEntries[1].currentSourceHash, hash("external conflict"));
    await assert.rejects(readFile(sources[0]), { code: "ENOENT" }); assert.equal(await readFile(sources[1], "utf8"), "external conflict");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("UTF-8 fixed effect evidence is withheld as whole references rather than escaping the native error budget", async () => {
  const native = { outcome: "blocked", code: "fixture_refused", summary: "Refused" };
  const observations = newObservations(); observations.documentEffects = "observed"; observations.references = Array.from({ length: 8 }, (_, id) => String(id) + "界".repeat(4095)); observations.referenceTotal = 8;
  attachObservations(native, observations);
  const result = await nativeToolResult("project_todo_create", async () => ({ native, text: "Refused", details: {} }));
  assert.equal(result.isError, true); assert.equal(result.structuredContent.ok, false);
  assert(Buffer.byteLength(JSON.stringify(result.structuredContent)) <= NATIVE_OUTPUT_BYTES_V1);
  assert.equal(result.structuredContent.effects.documentEffects, "possible");
  assert(result.structuredContent.effects.referencesOmitted > 0);
  assert.equal(result.structuredContent.effects.references.length + result.structuredContent.effects.referencesOmitted, 8);
  assert(result.structuredContent.effects.references.every(reference => observations.references.includes(reference)));
});

test("native confidence distinguishes raw matches from profile validity without gating raw metadata", async () => {
  const root = await fixture(); const host = await adapter(root);
  const registry = createArtifactProfileRegistryV1(); let token;
  try {
    await writeFile(path.join(root, "docs", "a.md"), "---\ncustom_mode: yes\n---\n# Confidence\n");
    for (const outcome of ["valid", "invalid"]) {
      token = registry.register(host.scope, {
        contractVersion: 1, kind: "artifact-profile", id: "fixture.confidence", owner: { packageName: "@fixture/profile", packageVersion: "1.0.0", packageRoot: root, registeredBy: "fixture" }, artifactKinds: ["doc"],
        fields: [{ name: "custom_mode", type: "string", indexed: true, filterable: true }],
        validators: [{ id: "fixture.validator", async validate() { return outcome === "valid" ? { outcome } : { outcome, issues: [{ code: "fixture_invalid", summary: "Finding" }] }; } }],
      });
      const result = await host.call("project_artifact_search", { filters: { custom_mode: "yes" }, freshnessMode: "strict" });
      assert.equal(result.structuredContent.ok, true); assert.equal(result.structuredContent.data.results.length, 1);
      assert.equal(result.structuredContent.data.results[0].filterSemantics.items[0].confidence, outcome === "valid" ? "profile_validated" : "profile_warning");
      assert.equal(result.structuredContent.data.results[0].profileValidation.items[0].outcome, outcome);
      assert.equal(result.structuredContent.data.provenance.profiles[0].profileId, "fixture.confidence");
      registry.unregister(token); token = undefined;
    }
  } finally { if (token) registry.unregister(token); await host.close(); await rm(root, { recursive: true, force: true }); }
});

test("missing todo roots retain native failure and observed root availability, not successful emptiness", async () => {
  const root = await fixture(); const host = await adapter(root);
  try {
    await rm(path.join(root, "todos"), { recursive: true });
    const listed = await host.call("project_todo_list");
    assert.equal(listed.structuredContent.ok, false); assert.equal(listed.isError, true); assert.equal(listed.structuredContent.todoRootState, "missing");
    assert.equal(listed.structuredContent.completeness, undefined);
    assert.match(listed.content.map(block => block.text).join(" "), /Todo root: missing/);
    const created = await host.call("project_todo_create", { title: "New root", priority: "p2", body: "Body" });
    assert.equal(created.structuredContent.todoRootState, "present"); assert.equal(created.structuredContent.effects.documentEffects, "observed");
    assert(created.structuredContent.effects.references.includes(path.join(root, "todos")));
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});

test("recovery containment failure withholds unadmitted journal paths without reading or repairing them", async () => {
  const root = await fixture();
  try {
    const run = path.join(root, ".pi-project-artifacts", "todo-transitions-v1", "outside-fixture"); await mkdir(run, { recursive: true });
    const outside = path.join(path.dirname(root), "outside-private-identity.md");
    await writeFile(path.join(run, "journal.json"), JSON.stringify({ schema: "@aefree/pi-project-artifacts/todo-transition-journal", version: 1, state: "prepared", source: outside, target: path.join(root, "todos", "001-complete-p2-task.md"), sourceHash: hash("source"), targetHash: hash("target"), sourceMode: 0o644 }));
    const failed = await nativeTodo(root, "project_todo_allocate", { operation: "allocate_id" });
    assert.equal(failed.structuredContent.ok, false); assert.equal(failed.isError, true);
    assert.equal(failed.structuredContent.effects.recoveryStarted, 1); assert.equal(failed.structuredContent.effects.recoveryCompleted, 0);
    assert.deepEqual(failed.structuredContent.effects.recoveryEntries, []); assert.equal(failed.structuredContent.effects.recoveryEntriesOmitted, 1);
    assert.equal(JSON.stringify(failed).includes("outside-private-identity"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
