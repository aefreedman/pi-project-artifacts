import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createArtifactProfileRegistryV1, resolveArtifactProfilesV1 } from "../dist/contracts/v1/index.js";
import { buildOrRefreshIndex, describeArtifactWorkspace, executeArtifactSearch, trackArtifactToolResult } from "../dist/core/index.js";

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

test("auto TTL, expiry, and memory modes report distinct cache states", async () => {
  const root = await fixture();
  try {
    await put(root, "docs/cache.md", "# Cache\n\ncache-state-needle\n");
    const initial = await executeArtifactSearch(context(root), { query: "cache-state-needle", freshnessMode: "strict" }, missingProfiles());
    assert.equal(initial.details.cacheState, "rebuilt");
    assert.equal(initial.details.fastPath, false);
    assert.match(initial.text, /Index rebuilt \(strict\)/);

    const auto = await executeArtifactSearch(context(root), { query: "cache-state-needle", freshnessMode: "auto", freshnessTtlMs: 60_000 }, missingProfiles());
    assert.equal(auto.details.cacheState, "auto_fast_path");
    assert.equal(auto.details.fastPath, true);
    assert.match(auto.text, /cache reused \(auto TTL fast path\)/);

    const memory = await executeArtifactSearch(context(root), { query: "cache-state-needle", freshnessMode: "memory" }, missingProfiles());
    assert.equal(memory.details.cacheState, "memory_fast_path");
    assert.equal(memory.details.fastPath, true);
    assert.match(memory.text, /cache reused \(memory fast path\)/);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const expired = await executeArtifactSearch(context(root), { query: "cache-state-needle", freshnessMode: "auto", freshnessTtlMs: 0 }, missingProfiles());
    assert.equal(expired.details.cacheState, "validated_unchanged");
    assert.equal(expired.details.fastPath, false);
    assert.equal(expired.details.refreshed, false);
    assert.match(expired.text, /validated unchanged \(auto\)/);
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
    assert.equal(dirty.details.fastPath, false);
    assert.equal(dirty.details.cacheState, "rebuilt");
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
    assert.equal(raw.details.results[0].filterSemantics.items[0].confidence, "raw_exact");
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
      assert.equal(result.details.results[0].filterSemantics.items[0].confidence, "profile_validated");
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
    assert.deepEqual(typed.details.results[0].profileValidation.items.map((entry) => entry.outcome), ["invalid"]);
    assert.equal(typed.details.validationDiagnostics.indexed.byOutcome.invalid, 1);
    assert.equal(typed.details.validationDiagnostics.indexed.byOutcome.unavailable, 1);
    assert.equal(typed.details.validationDiagnostics.indexed.warningEvidence.length, 2);
    const openType = await executeArtifactSearch(context(root), { filters: { attempts: "two" }, freshnessMode: "strict" }, resolution);
    const openEnum = await executeArtifactSearch(context(root), { filters: { mode: "unsafe" }, freshnessMode: "strict" }, resolution);
    assert.equal(openType.details.resultCount, 0);
    assert.equal(openEnum.details.resultCount, 0);
    assert.equal(typed.details.results[0].filterSemantics.items.find((field) => field.field === "attempts").confidence, "profile_warning");
    const unavailable = await executeArtifactSearch(context(root), { filters: { attempts: "3" }, freshnessMode: "strict" }, resolution);
    assert.equal(unavailable.details.results[0].filterSemantics.items[0].confidence, "profile_warning");
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
    assert.equal(owned.details.results.find((entry) => entry.path === "docs/owned.md").filterSemantics.items[0].confidence, "profile_validated");
    assert.equal(owned.details.results.find((entry) => entry.path === "docs/raw.md").filterSemantics.items[0].confidence, "raw_exact");
    const generic = await executeArtifactSearch(context(root), { filters: { status: "review", priority: "urgent", severity: "notice" }, freshnessMode: "strict" }, resolution);
    assert.deepEqual(generic.details.results.map((entry) => entry.path), ["docs/owned.md"]);

    outcome = "invalid";
    const invalid = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(invalid.details.refreshStats.updated, 1, "strict refresh must re-run unchanged Markdown validators");
    assert.equal(invalid.details.validationDiagnostics.indexed.byOutcome.invalid, 1);

    applies = false;
    const stillRaw = await executeArtifactSearch(context(root), { filters: { owned_field: "yes" }, freshnessMode: "strict" }, resolution);
    assert.equal(stillRaw.details.resultCount, 2);
    assert(stillRaw.details.results.every((entry) => entry.filterSemantics.items[0].confidence === "raw_exact"));
    const stable = await executeArtifactSearch(context(root), { freshnessMode: "strict" }, resolution);
    assert.equal(stable.details.refreshed, false, "unchanged profile results should not rewrite the index");
    assert.equal(stable.details.refreshStats.updated, 0);
    assert.equal(stable.provenance.profiles.find((profile) => profile.profileId === "fixture.owned")?.decision, "not_applicable");
    assert.equal(stable.details.filtering.knownProfileFieldCount >= 7, true, "search retains only a bounded count of registered profile schemas");
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
      assert.equal(result.details.results[0].filterSemantics.items[0].confidence, "profile_validated");
      assert.equal(result.details.results[0].filterSemantics.items[0].profiles.length, field === "phase" ? 2 : 1);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("focused detailed catalog and search details suppress credential-shaped neutral values", async () => {
  const root = await fixture();
  try {
    const secrets = ["top-secret-value", ["AKIA", "IOSFODNN7EXAMPLE"].join(""), ["sk", "live", "123456789012345678901234"].join("_"), ["sk", "test", "123456789012345678901234"].join("_"), ["AI", "za12345678901234567890123456789012345"].join(""), ["gl", "pat-12345678901234567890"].join(""), "https://alice:password@example.test/path"];
    await put(root, "docs/one.md", `---\nengine: Unity\ntoken: ${secrets[0]}\nopaque_aws: ${secrets[1]}\nopaque_stripe_live: ${secrets[2]}\nopaque_stripe_test: ${secrets[3]}\nopaque_google: ${secrets[4]}\nopaque_gitlab: ${secrets[5]}\nopaque_url: ${secrets[6]}\nlong_value: ${"x".repeat(100)}\nflags: [true, false]\n---\n# One\n`);
    await put(root, "docs/two.md", "---\nengine: Unreal\ntoken: another-secret\nflags: [true]\n---\n# Two\n");
    const names = ["engine", "token", "opaque_aws", "opaque_stripe_live", "opaque_stripe_test", "opaque_google", "opaque_gitlab", "opaque_url", "long_value"];
    const described = await describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: names, includeSamples: true, freshnessMode: "strict" }, missingProfiles());
    const catalog = described.observedFieldCatalog;
    const engine = catalog.fields.find((field) => field.name === "engine");
    assert.deepEqual(engine.sampleValues, ["Unity", "Unreal"]);
    assert.equal(engine.documentCount, 2);
    for (const name of names.filter((name) => name !== "engine")) assert.deepEqual(catalog.fields.find((field) => field.name === name).sampleValues, []);
    const result = await executeArtifactSearch(context(root), { query: "one", freshnessMode: "strict" }, missingProfiles());
    assert.equal("observedFieldCatalog" in result.details, false);
    for (const secret of secrets) {
      assert.equal(JSON.stringify(described).includes(secret), false);
      assert.equal(JSON.stringify(result.details).includes(secret), false);
    }
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
      validators: [{ id: "outcome", async validate() { return { outcome: "invalid", issues: [{ code: "profile_warning", summary: "profile warns" }] }; } }],
    });
  }
  try {
    await put(root, "docs/profiles.md", "---\nshared_field: yes\n---\n# Profiles\n");
    const result = await executeArtifactSearch(context(root), { filters: { shared_field: "yes" }, freshnessMode: "strict" }, resolveArtifactProfilesV1(scope, registry));
    const semantics = result.details.results[0].filterSemantics.items[0];
    assert.equal(semantics.confidence, "profile_warning");
    assert.equal(semantics.profiles.length, 8);
    assert.equal(semantics.profilesTruncated, true);
    assert.equal(semantics.totalProfiles, 9);
    assert.equal(semantics.omittedProfiles, 1);
    assert.equal(result.details.results[0].profileValidation.total, 9);
    assert.equal(result.details.results[0].profileValidation.truncated, true);
    assert.equal(result.details.validationDiagnostics.indexed.warningTotal, 9);
    assert.equal(result.details.validationDiagnostics.indexed.warningEvidenceTruncated, true);
    assert.match(result.text, /shared_field=profile_warning \[.*omitted\]/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compact describe enumerates mature-project fields without samples, while focused inspection stays safe and filterable", async () => {
  const root = await fixture();
  try {
    const fields = Array.from({ length: 145 }, (_, index) => `rare_field_${String(index + 1).padStart(3, "0")}: ${`value-${index + 1}-`.padEnd(70, "x")}`);
    fields.push("path_hint: C:\\\\Users\\\\alice\\\\private\\\\build", "relative_path: docs/private/build.md", "common: shared");
    await put(root, "docs/catalog.md", `---\n${fields.join("\n")}\n---\n# Catalog\n`);
    const compact = await describeArtifactWorkspace(context(root), { outputMode: "compact", freshnessMode: "strict" }, missingProfiles());
    const detailed = await describeArtifactWorkspace(context(root), { outputMode: "detailed", freshnessMode: "strict" }, missingProfiles());
    assert.equal(compact.observedFieldCatalog.totalFieldCount, 148);
    assert.equal(compact.observedFieldCatalog.fields.length, 148, "every observed name/count is discoverable in compact mode");
    assert(compact.observedFieldCatalog.fields.every((field) => field.sampleValues === undefined), "compact mode must omit sample values");
    assert(detailed.observedFieldCatalog.fields.every((field) => field.sampleValues === undefined), "detailed mode still omits samples without explicit focused opt-in");
    assert(JSON.stringify(compact).length < JSON.stringify(detailed).length * 0.75, "compact catalog must be materially smaller");
    const focused = await describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: ["rare_field_001", "path_hint", "relative_path"], includeSamples: true, freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(focused.observedFieldCatalog.fields.map((field) => field.name), ["path_hint", "rare_field_001", "relative_path"]);
    assert.deepEqual(focused.observedFieldCatalog.fields.find((field) => field.name === "path_hint").sampleValues, []);
    assert.deepEqual(focused.observedFieldCatalog.fields.find((field) => field.name === "relative_path").sampleValues, []);
    assert.equal(focused.observedFieldCatalog.fields.find((field) => field.name === "rare_field_001").sampleValues.length, 1);
    await assert.rejects(describeArtifactWorkspace(context(root), { outputMode: "compact", includeSamples: true }, missingProfiles()), /requires outputMode detailed/);
    await assert.rejects(describeArtifactWorkspace(context(root), { outputMode: "detailed", includeSamples: true }, missingProfiles()), /requires a non-empty focused fieldNames/);
    await assert.rejects(describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: [], freshnessMode: "strict" }, missingProfiles()), /1-20 names/);
    await assert.rejects(describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: ["common", "common"], freshnessMode: "strict" }, missingProfiles()), /duplicates/);
    await assert.rejects(describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: Array.from({ length: 21 }, (_, index) => `field_${index}`), freshnessMode: "strict" }, missingProfiles()), /1-20 names/);
    const rare = await executeArtifactSearch(context(root), { filters: { rare_field_145: `value-145-`.padEnd(70, "x") }, freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(rare.details.results.map((entry) => entry.path), ["docs/catalog.md"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("frontmatter text search matches values only and result metadata is relevant and bounded", async () => {
  const root = await fixture();
  try {
    await put(root, "docs/metadata.md", "---\nfailure_mode: runtime_exception\nrare_signal: targetneedle\nmodule: unrelated-module\ncomponent: unrelated-component\nseverity: high\ntags: [unrelated-tag]\n---\n# Metadata\n");
    await put(root, "todos/001-ready-p1-metadata.md", "---\nstatus: ready\npriority: p1\ntags: [targetneedle, another-tag, third-tag, fourth-tag, fifth-tag]\nmodule: unrelated-module\n---\n# Todo\n\ntargetneedle\n");
    const nameOnly = await executeArtifactSearch(context(root), { query: "failure mode", searchFields: ["frontmatter"], freshnessMode: "strict" }, missingProfiles());
    assert.equal(nameOnly.details.resultCount, 0, "field labels alone must not produce general text matches");
    const exact = await executeArtifactSearch(context(root), { filters: { failure_mode: "runtime_exception" }, freshnessMode: "strict" }, missingProfiles());
    assert.deepEqual(exact.details.results.map((entry) => entry.path), ["docs/metadata.md"]);
    const result = await executeArtifactSearch(context(root), { query: "targetneedle", freshnessMode: "strict" }, missingProfiles());
    const doc = result.details.results.find((entry) => entry.path === "docs/metadata.md");
    const todo = result.details.results.find((entry) => entry.path === "todos/001-ready-p1-metadata.md");
    assert.deepEqual(doc.metadataFacets.items.map((facet) => facet.field), ["rare_signal"]);
    assert(todo.metadataFacets.items.some((facet) => facet.field === "tags" && facet.values.length <= 4));
    assert(todo.metadataFacets.items.some((facet) => facet.field === "status"));
    assert(todo.metadataFacets.items.some((facet) => facet.field === "priority"));
    assert(todo.metadataFacets.items.length <= 6);
    assert(!result.text.includes("unrelated-module"), "fixed irrelevant metadata labels/values must not be emitted");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("search payloads retain bounded facets, todo state, and mature-workspace size", async () => {
  const root = await fixture();
  try {
    const filterLines = Array.from({ length: 9 }, (_, index) => `facet_${index + 1}: yes`).join("\n");
    await put(root, "todos/001-ready-p1-facets.md", `---\nstatus: ready\npriority: p1\n${filterLines}\n---\n# Facets\n\nneedle\n`);
    for (let index = 0; index < 120; index += 1) {
      const metadata = Array.from({ length: 20 }, (_, field) => `large_field_${field}: ${"x".repeat(80)}`).join("\n");
      await put(root, `docs/mature-${index}.md`, `---\n${metadata}\n---\n# Mature ${index}\n\nneedle\n`);
    }
    const filters = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`facet_${index + 1}`, "yes"]));
    const compact = await executeArtifactSearch(context(root), { query: "needle", filters, outputMode: "compact", freshnessMode: "strict" }, missingProfiles());
    const detailed = await executeArtifactSearch(context(root), { query: "needle", filters, outputMode: "detailed", freshnessMode: "strict" }, missingProfiles());
    const item = compact.details.results[0];
    assert.equal(item.metadataFacets.total, 11);
    assert.equal(item.metadataFacets.truncated, true);
    assert.equal(item.metadataFacets.omitted, 3);
    assert(item.metadataFacets.items.some((facet) => facet.field === "status"));
    assert(item.metadataFacets.items.some((facet) => facet.field === "priority"));
    assert.match(compact.text, /status=ready/);
    assert.match(detailed.text, /priority=p1/);
    assert.equal("frontmatter" in item, false);
    assert.equal("observedFieldCatalog" in compact.details, false);
    assert(JSON.stringify(compact.details).length < 100_000, "ordinary mature search payload stays bounded");
    assert(JSON.stringify(compact.details).length < JSON.stringify(detailed.details).length + 10_000, "mode changes presentation, not an unbounded details dump");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("observed distinct-value cap ignores duplicates at the boundary and caps on the 101st distinct value", async () => {
  const root = await fixture();
  try {
    const firstHundred = Array.from({ length: 100 }, (_, index) => `value-${index + 1}`);
    await put(root, "docs/values.md", `---\nvalues: [${[...firstHundred, "value-100"].join(", ")}]\n---\n# Values\n`);
    const initial = await describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: ["values"], freshnessMode: "strict" }, missingProfiles());
    const before = initial.observedFieldCatalog.fields.find((field) => field.name === "values");
    assert.equal(before.distinctCount, 100);
    assert.equal(before.distinctCountCapped, false);
    await put(root, "docs/values.md", `---\nvalues: [${[...firstHundred, "value-101"].join(", ")}]\n---\n# Values\n`);
    const updated = await describeArtifactWorkspace(context(root), { outputMode: "detailed", fieldNames: ["values"], freshnessMode: "strict" }, missingProfiles());
    assert.equal(updated.observedFieldCatalog.fields.find((field) => field.name === "values").distinctCountCapped, true);
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
