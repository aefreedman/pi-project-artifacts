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
    await put(root, "docs/raw.md", "---\nfailure-mode: runtime_exception\n---\n# Raw\n");
    const raw = await executeArtifactSearch(context(root), { filters: { "failure-mode": "runtime_exception" }, freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(raw.details.results.map((entry) => entry.path), ["docs/raw.md"]);
    assert.equal(raw.details.results[0].filterSemantics[0].confidence, "raw_exact");
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

test("mixed Unity, Unreal, and custom metadata remains independently raw-filterable", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  for (const [id, kind] of [["fixture.unity-engine", "solution"], ["fixture.unreal-engine", "plan"], ["fixture.custom-engine", "doc"]]) {
    registry.register(scope, {
      contractVersion: 1, id, kind: "artifact-profile",
      owner: { packageName: `@fixture/${id}`, packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
      artifactKinds: [kind], fields: [{ name: "engine", type: "string", indexed: true, filterable: true }], validators: [],
    });
  }
  try {
    await put(root, "docs/solutions/unity.md", "---\nengine: Unity\n---\n# Unity\n");
    await put(root, "docs/plans/unreal.md", "---\nengine: Unreal\n---\n# Unreal\n");
    await put(root, "docs/custom.md", "---\nengine: Custom\n---\n# Custom\n");
    const resolution = resolveArtifactProfilesV1(scope, registry);
    for (const [engine, pathname] of [["Unity", "docs/solutions/unity.md"], ["Unreal", "docs/plans/unreal.md"], ["Custom", "docs/custom.md"]]) {
      const result = await executeArtifactSearch(context(root), { filters: { engine }, freshnessMode: "strict" }, resolution);
      assert.deepEqual(result.details.results.map((entry) => entry.path), [pathname]);
      assert.equal(result.details.results[0].filterSemantics[0].confidence, "profile_validated");
    }
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

test("filters remain raw-open while profile validation diagnostics stay visible", async () => {
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
    const openType = await executeArtifactSearch(context(root), { filters: { attempts: "two" }, freshnessMode: "strict" }, resolution);
    const openEnum = await executeArtifactSearch(context(root), { filters: { mode: "unsafe" }, freshnessMode: "strict" }, resolution);
    assert.equal(openType.details.resultCount, 0);
    assert.equal(openEnum.details.resultCount, 0);
    assert.equal(typed.details.results[0].filterSemantics.find((field) => field.field === "attempts").confidence, "profile_warning");
    const unavailable = await executeArtifactSearch(context(root), { filters: { attempts: "3" }, freshnessMode: "strict" }, resolution);
    assert.equal(unavailable.details.results[0].filterSemantics[0].confidence, "profile_warning");
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
    assert.deepEqual(owned.details.results.map((entry) => entry.path), ["docs/owned.md", "docs/raw.md"], "raw frontmatter remains open even where a profile defines the field");
    assert.equal(owned.details.results.find((entry) => entry.path === "docs/owned.md").filterSemantics[0].confidence, "profile_validated");
    assert.equal(owned.details.results.find((entry) => entry.path === "docs/raw.md").filterSemantics[0].confidence, "raw_exact");
    const generic = await executeArtifactSearch(context(root), { filters: { status: "review", priority: "urgent", severity: "notice" }, freshnessMode: "strict" }, resolution);
    assert.deepEqual(generic.details.results.map((entry) => entry.path), ["docs/owned.md"]);

    outcome = "invalid";
    const invalid = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(invalid.details.refreshStats.updated, 1, "strict refresh must re-run unchanged Markdown validators");
    assert.equal(invalid.details.validationDiagnostics.indexed.byOutcome.invalid, 1);

    applies = false;
    const stillRaw = await executeArtifactSearch(context(root), { filters: { owned_field: "yes" }, freshnessMode: "strict" }, resolution);
    assert.equal(stillRaw.details.resultCount, 2);
    assert(stillRaw.details.results.every((entry) => entry.filterSemantics[0].confidence === "raw_exact"));
    const stable = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(stable.details.refreshed, false, "unchanged profile results should not rewrite the index");
    assert.equal(stable.details.refreshStats.updated, 0);
    assert.equal(stable.provenance.profiles.find((profile) => profile.profileId === "fixture.owned")?.decision, "not_applicable");
    assert.equal(stable.details.controls.filters.fields.some((field) => field.name === "owned_field"), true, "registered profile schemas remain visible even when no current artifact applies");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generic/profile and profile/profile collisions remain open raw filters with per-profile confidence", async () => {
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
      const result = await executeArtifactSearch(context(root), { filters: { [field]: field === "status" ? "review" : "alpha" }, freshnessMode: "strict" }, resolution);
      assert.equal(result.details.resultCount, 1);
      assert.equal(result.details.results[0].filterSemantics[0].confidence, "profile_validated");
      assert.equal(result.details.results[0].filterSemantics[0].profiles.length, field === "phase" ? 2 : 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("observed metadata catalog is bounded and suppresses sensitive samples", async () => {
  const root = await fixture();
  try {
    const apiKey = "top-secret-value";
    const accessKey = "another-secret";
    const neutralCredential = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    await put(root, "docs/one.md", `---\nengine: Unity\ntoken: ${apiKey}\napi_key: ${apiKey}\naccess_key: ${accessKey}\nopaque_value: ${neutralCredential}\nlong_value: ${"x".repeat(100)}\nflags: [true, false]\n---\n# One\n`);
    await put(root, "docs/two.md", "---\nengine: Unreal\ntoken: another-secret\nflags: [true]\n---\n# Two\n");
    const result = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, missingProfiles());
    const catalog = result.details.observedFieldCatalog;
    const engine = catalog.fields.find((field) => field.name === "engine");
    const token = catalog.fields.find((field) => field.name === "token");
    const longValue = catalog.fields.find((field) => field.name === "long_value");
    const apiKeyField = catalog.fields.find((field) => field.name === "api_key");
    const accessKeyField = catalog.fields.find((field) => field.name === "access_key");
    const opaqueValue = catalog.fields.find((field) => field.name === "opaque_value");
    assert.deepEqual(engine.sampleValues, ["Unity", "Unreal"]);
    assert.equal(engine.documentCount, 2);
    assert.deepEqual(token.sampleValues, []);
    assert.deepEqual(apiKeyField.sampleValues, []);
    assert.deepEqual(accessKeyField.sampleValues, []);
    assert.deepEqual(opaqueValue.sampleValues, []);
    assert.deepEqual(longValue.sampleValues, []);
    assert.equal(JSON.stringify(result.details).includes(apiKey), false);
    assert.equal(JSON.stringify(result.details).includes(accessKey), false);
    assert.equal(JSON.stringify(result.details).includes(neutralCredential), false);
    assert(catalog.fields.length <= 100);
    assert(engine.distinctCount <= 100);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("search text renders raw, validated, and warning filter semantics in compact and detailed modes", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  const definition = (id, field, outcome) => ({
    contractVersion: 1, id, kind: "artifact-profile",
    owner: { packageName: `@fixture/${id}`, packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
    artifactKinds: [], fields: [{ name: field, type: "string", indexed: true, filterable: true }],
    validators: [{ id: "outcome", async validate() { return outcome === "valid" ? { outcome } : { outcome, issues: [{ code: "fixture_warning", summary: "fixture warning" }] }; } }],
  });
  registry.register(scope, definition("fixture.valid", "validated_field", "valid"));
  registry.register(scope, definition("fixture.warning", "warning_field", "invalid"));
  try {
    await put(root, "docs/semantics.md", "---\nraw_field: yes\nvalidated_field: yes\nwarning_field: yes\n---\n# Semantics\n");
    const resolution = resolveArtifactProfilesV1(scope, registry);
    for (const outputMode of ["compact", "detailed"]) for (const [field, confidence] of [["raw_field", "raw_exact"], ["validated_field", "profile_validated"], ["warning_field", "profile_warning"]]) {
      const result = await executeArtifactSearch(context(root), { filters: { [field]: "yes" }, outputMode, freshnessMode: "strict" }, resolution);
      assert.match(result.text, new RegExp(`filter semantics: ${field}=${confidence}`));
      if (field === "validated_field") assert.match(result.text, /fixture\.valid=valid/);
      if (field === "warning_field") assert.match(result.text, /fixture\.warning=invalid/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("filter confidence includes every applicable profile before profile evidence is truncated", async () => {
  const root = await fixture();
  const scope = {};
  const registry = createArtifactProfileRegistryV1();
  for (let number = 1; number <= 9; number += 1) {
    const id = `fixture.profile-${String(number).padStart(2, "0")}`;
    registry.register(scope, {
      contractVersion: 1, id, kind: "artifact-profile",
      owner: { packageName: `@fixture/${id}`, packageVersion: "1.0.0", packageRoot: "/fixture", registeredBy: "test" },
      artifactKinds: [], fields: [{ name: "shared_field", type: "string", indexed: true, filterable: true }],
      validators: [{ id: "outcome", async validate() { return number === 9 ? { outcome: "invalid", issues: [{ code: "ninth_warning", summary: "ninth profile warns" }] } : { outcome: "valid" }; } }],
    });
  }
  try {
    await put(root, "docs/profiles.md", "---\nshared_field: yes\n---\n# Profiles\n");
    const result = await executeArtifactSearch(context(root), { filters: { shared_field: "yes" }, freshnessMode: "strict" }, resolveArtifactProfilesV1(scope, registry));
    const semantics = result.details.results[0].filterSemantics[0];
    assert.equal(semantics.confidence, "profile_warning");
    assert.equal(semantics.profiles.length, 8);
    assert.equal(semantics.profilesTruncated, true);
    assert.match(result.text, /shared_field=profile_warning \[.*truncated\]/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("observed distinct-value cap ignores duplicates at the boundary and caps on the 101st distinct value", async () => {
  const root = await fixture();
  try {
    const firstHundred = Array.from({ length: 100 }, (_, index) => `value-${index + 1}`);
    await put(root, "docs/values.md", `---\nvalues: [${[...firstHundred, "value-100"].join(", ")}]\n---\n# Values\n`);
    const initial = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, missingProfiles());
    const before = initial.details.observedFieldCatalog.fields.find((field) => field.name === "values");
    assert.equal(before.distinctCount, 100);
    assert.equal(before.distinctCountCapped, false);
    await put(root, "docs/values.md", `---\nvalues: [${[...firstHundred, "value-101"].join(", ")}]\n---\n# Values\n`);
    const updated = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, missingProfiles());
    assert.equal(updated.details.observedFieldCatalog.fields.find((field) => field.name === "values").distinctCountCapped, true);
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
