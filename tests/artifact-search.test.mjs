import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactProfileRegistryV1, resolveArtifactProfilesV1 } from "../dist/contracts/v1/index.js";
import { buildOrRefreshIndex, executeArtifactSearch, trackArtifactToolResult } from "../dist/core/index.js";

const context = (cwd) => ({ cwd, signal: new AbortController().signal });
const missingProfiles = (scope = {}) => resolveArtifactProfilesV1(scope);
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-artifacts-"));
  await mkdir(path.join(root, "docs", "solutions"), { recursive: true });
  await mkdir(path.join(root, "todos"), { recursive: true });
  return root;
}
async function put(root, relative, content) { const target = path.join(root, relative); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content); return target; }

test("canonical index rebuilds add/update/delete and leaves legacy cache untouched", async () => {
  const root = await fixture();
  try {
    const legacy = await put(root, ".compound-game-dev/artifact-index.json", JSON.stringify({ version: 4, generatedAt: new Date().toISOString(), workspaceRoot: root, files: {} }));
    await put(root, "docs/solutions/combat.md", "---\ntags: [combat]\nmodule: battle\n---\n# Combat\n\nbodyneedle\n");
    const first = await executeArtifactSearch(context(root), { query: "combat", freshnessMode: "strict" }, missingProfiles());
    assert.equal(first.details.resultCount, 1);
    assert.match(first.details.indexPath, /\.pi-project-artifacts\/index-v1\.json$/);
    assert.equal(JSON.parse(await readFile(legacy, "utf8")).version, 4);
    assert.equal(first.details.refreshStats.added, 1);

    await put(root, "docs/solutions/combat.md", "---\ntags: [combat]\nmodule: battle\n---\n# Combat Updated\n\nupdatedneedle with changed bytes\n");
    const updated = await executeArtifactSearch(context(root), { query: "updatedneedle", freshnessMode: "strict" }, missingProfiles());
    assert.equal(updated.details.refreshStats.updated, 1);
    await rm(path.join(root, "docs/solutions/combat.md"));
    const removed = await executeArtifactSearch(context(root), { query: "combat", freshnessMode: "strict" }, missingProfiles());
    assert.equal(removed.details.refreshStats.removed, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("legacy artifact-search ranking, status, body, related, limit, and dirty-refresh behavior is characterized", async () => {
  const root = await fixture();
  try {
    await put(root, "docs/solutions/combat.md", "---\ntags: [combat, core]\nmodule: battle\nseverity: high\n---\n# Combat System\n\nbodyneedle links to todos/001-completed-p1-combat.md.\n");
    await put(root, "docs/notes/related.md", "# Related\n\nSee docs/solutions/combat.md.\n");
    await put(root, "todos/001-completed-p1-combat.md", "---\nstatus: completed\npriority: p1\ntags: [combat]\n---\n# Combat Todo\n\ncombat task\n");
    const ranked = await executeArtifactSearch(context(root), { query: "combat", freshnessMode: "strict" }, missingProfiles());
    assert.equal(ranked.details.resultCount, 3);
    assert.equal(ranked.details.results[0].path, "todos/001-completed-p1-combat.md");
    const complete = await executeArtifactSearch(context(root), { query: "combat", filters: { status: "complete" }, freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(complete.details.results.map((entry) => entry.path), ["todos/001-completed-p1-combat.md"]);
    const excluded = await executeArtifactSearch(context(root), { query: "combat", includeCompletedTodos: false, freshnessMode: "strict" }, missingProfiles());
    assert(!excluded.details.results.some((entry) => entry.kind === "todo"));
    const detailed = await executeArtifactSearch(context(root), { query: "bodyneedle", outputMode: "detailed", freshnessMode: "strict" }, missingProfiles());
    assert.match(detailed.text, /snippet:.*bodyneedle/i);
    const compact = await executeArtifactSearch(context(root), { query: "bodyneedle", outputMode: "compact", freshnessMode: "strict" }, missingProfiles());
    assert(!compact.text.includes("snippet:"));
    const noBody = await executeArtifactSearch(context(root), { query: "bodyneedle", includeBody: false, freshnessMode: "strict" }, missingProfiles());
    assert.equal(noBody.details.resultCount, 0);
    const related = await executeArtifactSearch(context(root), { query: "Combat System", includeRelated: true, freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(related.details.results[0].related.map((entry) => [entry.path, entry.relation]), [["todos/001-completed-p1-combat.md", "linksTo"], ["docs/notes/related.md", "linkedFrom"]]);
    const limited = await executeArtifactSearch(context(root), { query: "combat", limit: 1, freshnessMode: "strict" }, missingProfiles());
    assert.equal(limited.details.resultCount, 3);
    assert.equal(limited.details.returnedResultCount, 1);

    await put(root, "docs/dirty.md", "# Dirty\n\nbeforechange\n");
    await executeArtifactSearch(context(root), { query: "beforechange", freshnessMode: "strict" }, missingProfiles());
    await put(root, "docs/dirty.md", "# Dirty\n\nafterchange with a new size\n");
    trackArtifactToolResult({ toolName: "write", input: { path: "docs/dirty.md" } }, root);
    const dirty = await executeArtifactSearch(context(root), { query: "afterchange", freshnessMode: "auto", freshnessTtlMs: 60000 }, missingProfiles());
    assert.equal(dirty.details.refreshed, true);
    assert.equal(dirty.details.resultCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed frontmatter remains searchable and generic search survives missing profile", async () => {
  const root = await fixture();
  try {
    await put(root, "docs/malformed.md", "---\nbroken: [\n# Malformed\n\nmalformedneedle\n");
    const result = await executeArtifactSearch(context(root), { query: "malformedneedle", freshnessMode: "strict" }, missingProfiles());
    assert.equal(result.details.resultCount, 1);
    assert(result.provenance.fallbacks.some((entry) => entry.code === "artifact_profiles_missing"));
    await assert.rejects(
      executeArtifactSearch(context(root), { filters: { failure_mode: "runtime_exception" }, freshnessMode: "strict" }, missingProfiles()),
      (error) => error.code === "missing_profile",
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile-defined v1/v2 filters remain explicit and deterministic", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  registry.register(scope, {
    contractVersion: 1, id: "fixture.unity", kind: "artifact-profile",
    owner: { packageName: "@fixture/unity", packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
    artifactKinds: ["solution"],
    fields: [
      { name: "problem_type", type: "string", indexed: true, filterable: true },
      { name: "failure_mode", type: "string", indexed: true, filterable: true },
    ],
    validators: [{ id: "fixture", async validate() { return { outcome: "valid" }; } }],
  });
  try {
    await put(root, "docs/solutions/v1.md", "---\nproblem_type: runtime_error\n---\n# V1\n");
    await put(root, "docs/solutions/v2.md", "---\nfailure_mode: runtime_exception\n---\n# V2\n");
    const resolution = resolveArtifactProfilesV1(scope, registry);
    const v1 = await executeArtifactSearch(context(root), { filters: { problem_type: "runtime_error" }, freshnessMode: "strict" }, resolution);
    const v2 = await executeArtifactSearch(context(root), { filters: { failure_mode: "runtime_exception" }, freshnessMode: "strict" }, resolution);
    assert.deepEqual(v1.details.results.map((entry) => entry.path), ["docs/solutions/v1.md"]);
    assert.deepEqual(v2.details.results.map((entry) => entry.path), ["docs/solutions/v2.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("memories have a distinct scope and body search discloses its preview boundary", async () => {
  const root = await fixture();
  try {
    const tailTerm = "tailonlyneedle";
    await put(root, "docs/memories/decision.md", `# Memory Needle\n\n${"x".repeat(1_250)}${tailTerm}\n`);
    const memory = await executeArtifactSearch(context(root), { query: "memory needle", scopes: ["memories"], freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(memory.details.results.map((entry) => entry.path), ["docs/memories/decision.md"]);
    assert.equal(memory.details.results[0].kind, "memory");
    const tail = await executeArtifactSearch(context(root), { query: tailTerm, freshnessMode: "strict" }, missingProfiles());
    assert.equal(tail.details.resultCount, 0);
    assert.equal(tail.details.searchCoverage.body.indexedCharactersPerDocument, 1200);
    assert.match(tail.text, /preview-only.*1200.*rg.*read/i);
    assert.match(tail.details.controls.bodySearchCoverage.exhaustiveSearch, /suggestedRg.*read/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("filters are exact, typed profile values are checked, and validation diagnostics remain visible", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  registry.register(scope, {
    contractVersion: 1, id: "fixture.typed", kind: "artifact-profile",
    owner: { packageName: "@fixture/typed", packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
    artifactKinds: [],
    fields: [
      { name: "attempts", type: "integer", indexed: true, filterable: true },
      { name: "mode", type: "string", indexed: true, filterable: true, enumValues: ["safe", "fast"] },
    ],
    validators: [{ id: "diagnose", async validate(_context, request) {
      return request.artifact.frontmatter.invalid === true
        ? { outcome: "invalid", issues: [{ code: "fixture_invalid", summary: "fixture validation failed" }] }
        : request.artifact.frontmatter.unavailable === true
          ? { outcome: "unavailable", code: "fixture_unavailable", retryable: true }
          : { outcome: "valid" };
    } }],
  });
  try {
    await put(root, "docs/one.md", "---\ncomponent: renderer\nattempts: 2\nmode: safe\ninvalid: true\n---\n# One\n");
    await put(root, "docs/two.md", "---\ncomponent: rendering\nattempts: 3\nmode: fast\nunavailable: true\n---\n# Two\n");
    const resolution = resolveArtifactProfilesV1(scope, registry);
    const exact = await executeArtifactSearch(context(root), { filters: { component: "render" }, freshnessMode: "strict" }, resolution);
    assert.equal(exact.details.resultCount, 0);
    const typed = await executeArtifactSearch(context(root), { filters: { attempts: "2", mode: "safe" }, freshnessMode: "strict" }, resolution);
    assert.deepEqual(typed.details.results.map((entry) => entry.path), ["docs/one.md"]);
    assert.deepEqual(typed.details.results[0].profileValidation.map((entry) => entry.validation.outcome), ["invalid"]);
    assert.equal(typed.details.validationDiagnostics.indexed.byOutcome.invalid, 1);
    assert.equal(typed.details.validationDiagnostics.indexed.byOutcome.unavailable, 1);
    assert.equal(typed.details.validationDiagnostics.indexed.diagnostics.length, 2);
    await assert.rejects(executeArtifactSearch(context(root), { filters: { attempts: "two" }, freshnessMode: "strict" }, resolution), (error) => error.code === "filter_type_invalid");
    await assert.rejects(executeArtifactSearch(context(root), { filters: { mode: "unsafe" }, freshnessMode: "strict" }, resolution), (error) => error.code === "filter_enum_invalid");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile-owned filters require applicable profile data, refresh dynamic profile state, and preserve generic Markdown filters", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  let applies = true;
  let outcome = "valid";
  registry.register(scope, {
    contractVersion: 1, id: "fixture.owned", kind: "artifact-profile",
    owner: { packageName: "@fixture/owned", packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
    artifactKinds: [],
    fields: [{ name: "owned_field", type: "string", indexed: true, filterable: true }],
    validators: [{ id: "dynamic", async validate() {
      return outcome === "valid" ? { outcome: "valid" } : { outcome: "invalid", issues: [{ code: "dynamic_invalid", summary: "external state changed" }] };
    } }],
    async appliesTo(_context, request) { return applies && !request.artifactPath?.endsWith("raw.md"); },
  });
  registry.register(scope, {
    contractVersion: 1, id: "fixture.inactive-status", kind: "artifact-profile",
    owner: { packageName: "@fixture/inactive-status", packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
    artifactKinds: [], fields: [{ name: "status", type: "string", indexed: true, filterable: true }], validators: [],
    async appliesTo() { return false; },
  });
  try {
    await put(root, "docs/owned.md", "---\nowned_field: yes\nstatus: review\npriority: urgent\nseverity: notice\n---\n# Owned\n");
    await put(root, "docs/raw.md", "---\nowned_field: yes\n---\n# Raw\n");
    const resolution = resolveArtifactProfilesV1(scope, registry);
    const initial = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(initial.details.resultCount, 2, "generic unfiltered search must not require a profile");
    assert.equal(initial.provenance.profiles.find((profile) => profile.profileId === "fixture.owned")?.decision, "applied");
    assert.equal(initial.provenance.profiles.find((profile) => profile.profileId === "fixture.inactive-status")?.decision, "not_applicable");
    const owned = await executeArtifactSearch(context(root), { filters: { owned_field: "yes" }, freshnessMode: "strict" }, resolution);
    assert.deepEqual(owned.details.results.map((entry) => entry.path), ["docs/owned.md"], "raw frontmatter must not impersonate a profile field");
    const generic = await executeArtifactSearch(context(root), { filters: { status: "review", priority: "urgent", severity: "notice" }, freshnessMode: "strict" }, resolution);
    assert.deepEqual(generic.details.results.map((entry) => entry.path), ["docs/owned.md"]);

    outcome = "invalid";
    const invalid = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(invalid.details.refreshStats.updated, 1, "strict refresh must re-run unchanged Markdown validators");
    assert.equal(invalid.details.validationDiagnostics.indexed.byOutcome.invalid, 1);

    applies = false;
    await assert.rejects(
      executeArtifactSearch(context(root), { filters: { owned_field: "yes" }, freshnessMode: "strict" }, resolution),
      (error) => error.code === "missing_profile",
    );
    const stable = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(stable.details.refreshed, false, "unchanged profile results should not rewrite the index");
    assert.equal(stable.details.refreshStats.updated, 0);
    assert.equal(stable.provenance.profiles.find((profile) => profile.profileId === "fixture.owned")?.decision, "not_applicable");
    assert.equal(stable.details.controls.filters.fields.some((field) => field.name === "owned_field"), false, "non-applicable profile fields must not be exposed as controls");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unqualified generic/profile and profile/profile field collisions are rejected", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  const definition = (id, field) => ({
    contractVersion: 1, id, kind: "artifact-profile",
    owner: { packageName: `@fixture/${id}`, packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
    artifactKinds: [], fields: [{ name: field, type: "string", indexed: true, filterable: true }], validators: [],
  });
  registry.register(scope, definition("fixture.status", "status"));
  registry.register(scope, definition("fixture.phase-a", "phase"));
  registry.register(scope, definition("fixture.phase-b", "phase"));
  try {
    await put(root, "docs/collision.md", "---\nstatus: review\nphase: alpha\n---\n# Collision\n");
    const resolution = resolveArtifactProfilesV1(scope, registry);
    for (const field of ["status", "phase"]) {
      await assert.rejects(
        executeArtifactSearch(context(root), { filters: { [field]: field === "status" ? "review" : "alpha" }, freshnessMode: "strict" }, resolution),
        (error) => error.code === "filter_ambiguous" && /unqualified field-name collision/.test(error.message),
      );
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent rebuilds serialize through the owned index lock", async () => {
  const root = await fixture();
  try {
    await put(root, "docs/concurrent.md", "# Concurrent\n\nneedle\n");
    const [left, right] = await Promise.all([
      executeArtifactSearch(context(root), { query: "needle", rebuild: true }, missingProfiles()),
      executeArtifactSearch(context(root), { query: "needle", rebuild: true }, missingProfiles()),
    ]);
    assert.equal(left.details.resultCount, 1);
    assert.equal(right.details.resultCount, 1);
    assert.equal(existsSync(`${left.details.indexPath}.lock`), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("custom roots get isolated stable index identities", async () => {
  const root = await fixture();
  try {
    await put(root, "knowledge/a.md", "# A\n\ncustomneedle\n");
    await mkdir(path.join(root, "work"), { recursive: true });
    const custom = await executeArtifactSearch(context(root), { query: "customneedle", docsRoot: "knowledge", todosRoot: "work", freshnessMode: "strict" }, missingProfiles());
    const again = await executeArtifactSearch(context(root), { query: "customneedle", docsRoot: "knowledge", todosRoot: "work", freshnessMode: "memory" }, missingProfiles());
    assert.match(custom.details.indexPath, /index-v1-[a-z0-9_-]+-[a-f0-9]{10}\.json$/);
    assert.equal(custom.details.indexPath, again.details.indexPath);
    assert.equal(custom.details.rootIdentity, again.details.rootIdentity);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("explicit occupied paths, malformed locks, physical escapes, and write failures fail closed", async (t) => {
  const root = await fixture();
  try {
    await put(root, "docs/a.md", "# A\n");
    const occupied = await put(root, "occupied.json", JSON.stringify({ private: true }));
    await assert.rejects(buildOrRefreshIndex({ indexPath: occupied }, context(root)), (error) => error.code === "index_path_occupied");

    const indexPath = path.join(root, ".pi-project-artifacts", "index-v1.json");
    await mkdir(`${indexPath}.lock`, { recursive: true });
    await writeFile(path.join(`${indexPath}.lock`, "owner.json"), "not json");
    await assert.rejects(buildOrRefreshIndex({}, context(root)), (error) => error.code === "lock_owner_malformed");
    await rm(`${indexPath}.lock`, { recursive: true, force: true });

    let failed = false;
    await assert.rejects(buildOrRefreshIndex({ rebuild: true }, context(root), [], (point) => { if (point === "after_temp_fsync") { failed = true; throw new Error("injected"); } }), /injected/);
    assert.equal(failed, true);
    assert.equal(existsSync(`${indexPath}.lock`), false);

    if (process.platform !== "win32") {
      const outside = await mkdtemp(path.join(tmpdir(), "pi-artifacts-outside-"));
      await symlink(outside, path.join(root, "escape"), "dir");
      await assert.rejects(buildOrRefreshIndex({ indexPath: "escape/index.json" }, context(root)), (error) => error.code === "path_escape");
      await rm(outside, { recursive: true, force: true });
    } else t.diagnostic("symlink escape fixture skipped on Windows without guaranteed symlink privilege");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact roots stay within the session cwd while nested child workspaces remain supported", async () => {
  const coordination = await mkdtemp(path.join(tmpdir(), "pi-artifacts-coordination-"));
  const sibling = await mkdtemp(path.join(tmpdir(), "pi-artifacts-boundary-sibling-"));
  try {
    const child = path.join(coordination, "child");
    await mkdir(path.join(child, "docs"), { recursive: true });
    await mkdir(path.join(child, "todos"), { recursive: true });
    await put(child, "docs/nested.md", "# Nested\n\nchildneedle\n");
    const accepted = await executeArtifactSearch(context(coordination), { workspaceRoot: child, query: "childneedle", freshnessMode: "strict" }, missingProfiles());
    assert.equal(accepted.details.resultCount, 1);
    assert.equal(accepted.details.indexPath.startsWith(path.join(child, ".pi-project-artifacts").replaceAll("\\", "/")), true);

    await mkdir(path.join(sibling, "docs"), { recursive: true });
    await put(sibling, "docs/outside.md", "# Outside\n");
    for (const request of [
      { workspaceRoot: sibling },
      { workspaceRoot: path.dirname(coordination) },
      { workspaceRoot: child, docsRoot: path.join(sibling, "docs") },
      { workspaceRoot: child, todosRoot: sibling },
    ]) {
      await assert.rejects(buildOrRefreshIndex(request, context(coordination)), (error) => error.code === "path_escape");
    }
    assert.equal(existsSync(path.join(sibling, ".pi-project-artifacts")), false, "rejected sibling must not receive index or lock state");

    const junction = path.join(coordination, "junction-docs");
    await symlink(path.join(sibling, "docs"), junction, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(buildOrRefreshIndex({ workspaceRoot: child, docsRoot: junction }, context(coordination)), (error) => error.code === "path_escape");
  } finally {
    await rm(coordination, { recursive: true, force: true });
    await rm(sibling, { recursive: true, force: true });
  }
});
