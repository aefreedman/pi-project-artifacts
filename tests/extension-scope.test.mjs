import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import registerProjectArtifacts from "../dist/pi/index.js";
import {
  ARTIFACT_PROFILE_REGISTRY_KEY_V1,
  ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1,
  TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1,
  createArtifactProfileRegistryV1,
  resolveArtifactSearchServiceV1,
} from "../dist/contracts/v1/index.js";

class FakePi {
  handlers = new Map();
  tools = new Map();
  events = { emitted: [], emit: (name, payload) => { this.events.emitted.push({ name, payload }); } };

  on(name, callback) {
    const callbacks = this.handlers.get(name) ?? [];
    callbacks.push(callback);
    this.handlers.set(name, callbacks);
  }

  registerTool(tool) { this.tools.set(tool.name, tool); }

  async emit(name, context) {
    for (const callback of this.handlers.get(name) ?? []) await callback({}, context);
  }
}

const owner = (name) => ({
  packageName: `@fixture/${name}`,
  packageVersion: "1.0.0",
  packageRoot: "/fixture",
  registeredBy: "fixture",
});
const profile = (id, field, seen = []) => ({
  contractVersion: 1,
  id,
  kind: "artifact-profile",
  owner: owner(id),
  artifactKinds: [],
  fields: [{ name: field, type: "string", indexed: true, filterable: true }],
  validators: [],
  async appliesTo(context) {
    seen.push(context);
    return true;
  },
});

function reset() {
  for (const key of [ARTIFACT_PROFILE_REGISTRY_KEY_V1, ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1, TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1]) {
    delete globalThis[Symbol.for(key)];
  }
}
test.afterEach(reset);

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-artifact-extension-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "note.md"), "---\nprovider_first: yes\nlate_profile: yes\nscope_a: yes\nscope_b: yes\n---\n# Fixture\n");
  return root;
}

function context(scope, cwd) { return { sessionManager: scope, cwd }; }
async function search(pi, scope, cwd, params, signal = new AbortController().signal) {
  return await pi.tools.get("project_artifact_search").execute("tool-call", { freshnessMode: "strict", ...params }, signal, undefined, context(scope, cwd));
}

test("profile provider loaded before the Pi adapter is resolved for that invocation", async () => {
  const root = await workspace();
  try {
    const scope = { privateScopeMarker: "provider-first-private" };
    createArtifactProfileRegistryV1().register(scope, profile("fixture.provider-first", "provider_first"));
    const pi = new FakePi();
    registerProjectArtifacts(pi);
    await pi.emit("session_start", context(scope, root));

    const result = await search(pi, scope, root, { filters: { provider_first: "yes" } });
    assert.deepEqual(result.details.provenance.profiles.map((item) => item.profileId), ["fixture.provider-first"]);
    assert.equal(result.details.results.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("artifact describe exposes only workspace-applicable schemas with a fresh invocation context", async () => {
  const root = await workspace();
  try {
    const scope = {};
    const seen = [];
    createArtifactProfileRegistryV1().register(scope, {
      ...profile("fixture.schema", "mode", seen),
      fields: [{ name: "mode", type: "string", indexed: true, filterable: true, required: true, enumValues: ["safe", "fast"] }],
    });
    createArtifactProfileRegistryV1().register(scope, {
      ...profile("fixture.not-applicable", "hidden"),
      async appliesTo() { return false; },
    });
    const pi = new FakePi();
    registerProjectArtifacts(pi);
    await pi.emit("session_start", context(scope, root));
    const controller = new AbortController();
    const result = await pi.tools.get("project_artifact_describe").execute("describe", { workspaceRoot: root }, controller.signal, undefined, context(scope, root));
    const generic = result.details.fields.find((field) => field.name === "status" && field.owner.kind === "generic");
    const mode = result.details.fields.find((field) => field.name === "mode");
    assert.equal(generic.filterable, true);
    assert.deepEqual(generic.enumValues, []);
    assert.equal(result.details.fields.some((field) => field.name === "hidden"), false);
    assert.equal(result.details.workspaceRoot, root.replaceAll("\\", "/"));
    assert.deepEqual(result.details.profileAvailability.map((entry) => [entry.profileId, entry.decision]), [["fixture.not-applicable", "not_applicable"], ["fixture.schema", "applied"]]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].signal, controller.signal);
    assert.deepEqual(Object.keys(seen[0]).sort(), ["cwd", "requestId", "signal"]);
    assert.deepEqual(mode, {
      name: "mode", type: "string", indexed: true, filterable: true, required: true, enumValues: ["safe", "fast"],
      owner: { kind: "profile", profileId: "fixture.schema", packageName: "@fixture/fixture.schema", packageVersion: "1.0.0" },
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("late profile registration is resolved at execution time without exposing session scope", async () => {
  const root = await workspace();
  try {
    const scope = { privateScopeMarker: "late-profile-private" };
    const pi = new FakePi();
    registerProjectArtifacts(pi);
    await pi.emit("session_start", context(scope, root));
    assert.equal((await search(pi, scope, root, {})).details.provenance.profiles.length, 0);

    const seen = [];
    createArtifactProfileRegistryV1().register(scope, profile("fixture.late", "late_profile", seen));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const result = await search(pi, scope, root, { filters: { late_profile: "yes" } }, firstController.signal);
    await search(pi, scope, root, { rebuild: true }, secondController.signal);
    assert.deepEqual(result.details.provenance.profiles.map((item) => item.profileId), ["fixture.late"]);
    assert.equal(result.details.results.length, 1);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].signal, firstController.signal);
    assert.equal(seen[1].signal, secondController.signal);
    assert.notEqual(seen[0], seen[1]);
    assert.deepEqual(Object.keys(seen[0]).sort(), ["cwd", "requestId", "signal"]);
    assert.equal(JSON.stringify(result).includes("late-profile-private"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("separate adapter instances keep profile snapshots isolated by session scope", async () => {
  const root = await workspace();
  try {
    const scopeA = { privateScopeMarker: "scope-a-private" };
    const scopeB = { privateScopeMarker: "scope-b-private" };
    createArtifactProfileRegistryV1().register(scopeA, profile("fixture.scope-a", "scope_a"));
    createArtifactProfileRegistryV1().register(scopeB, profile("fixture.scope-b", "scope_b"));
    const piA = new FakePi();
    const piB = new FakePi();
    registerProjectArtifacts(piA);
    registerProjectArtifacts(piB);
    await piA.emit("session_start", context(scopeA, root));
    await piB.emit("session_start", context(scopeB, root));

    const resultA = await search(piA, scopeA, root, { filters: { scope_a: "yes" } });
    const resultB = await search(piB, scopeB, root, { filters: { scope_b: "yes" } });
    assert.deepEqual(resultA.details.provenance.profiles.map((item) => item.profileId), ["fixture.scope-a"]);
    assert.deepEqual(resultB.details.provenance.profiles.map((item) => item.profileId), ["fixture.scope-b"]);
    await assert.rejects(search(piA, scopeA, root, { filters: { scope_b: "yes" } }), (error) => error.code === "missing_profile");
    assert.equal(JSON.stringify(resultA).includes("scope-a-private"), false);
    assert.equal(JSON.stringify(resultB).includes("scope-b-private"), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("reload removes stale registrations and a delayed old shutdown preserves the active scope", async () => {
  const root = await workspace();
  try {
    const scopeA = {};
    const scopeB = {};
    const pi = new FakePi();
    registerProjectArtifacts(pi);
    await pi.emit("session_start", context(scopeA, root));
    assert.equal(resolveArtifactSearchServiceV1(scopeA).outcome, "available");
    await pi.emit("session_start", context(scopeB, root));
    assert.equal(resolveArtifactSearchServiceV1(scopeA).outcome, "missing");
    assert.equal(resolveArtifactSearchServiceV1(scopeB).outcome, "available");

    await pi.emit("session_shutdown", context(scopeA, root));
    assert.equal(resolveArtifactSearchServiceV1(scopeB).outcome, "available");
    await search(pi, scopeB, root, {});
    await pi.emit("session_shutdown", context(scopeB, root));
    assert.equal(resolveArtifactSearchServiceV1(scopeB).outcome, "missing");
  } finally { await rm(root, { recursive: true, force: true }); }
});
