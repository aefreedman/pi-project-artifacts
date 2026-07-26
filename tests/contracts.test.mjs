import assert from "node:assert/strict";
import test from "node:test";
import { createCapabilityRegistry, isRegistryError } from "@aefree/pi-capability-registry";
import {
  ARTIFACT_PROFILE_REGISTRY_KEY_V1,
  ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1,
  TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1,
  TODO_CANONICAL_FRONTMATTER_KEYS_V1,
  TODO_FORBIDDEN_FRONTMATTER_KEYS_V1,
  assertTodoLifecycleRequestV1,
  assertTodoLifecycleResultForRequestV1,
  assertTodoLifecycleResultV1,
  assertTodoPathContainedV1,
  canonicalizeTodoAbsolutePathV1,
  parseCanonicalTodoBasenameV1,
  resolveTodoPathContextV1,
  todoPathCollisionKeyV1,
  createArtifactProfileRegistryV1,
  createArtifactSearchServiceRegistryV1,
  resolveArtifactProfilesV1,
  resolveArtifactSearchServiceV1,
} from "../dist/contracts/v1/index.js";
import {
  assertArtifactProfileConformanceV1,
  assertArtifactSearchServiceConformanceV1,
  assertTodoLifecycleServiceConformanceV1,
} from "../dist/contracts/v1/conformance.js";

const hash = (hex = "a") => `sha256:${hex.repeat(64)}`;
const owner = (name = "@fixture/artifacts", root = "/fixture/artifacts") => ({
  packageName: name,
  packageVersion: "1.0.0",
  packageRoot: root,
  registeredBy: "fixture",
});
const profile = (id = "fixture.profile", seen = []) => ({
  contractVersion: 1,
  id,
  kind: "artifact-profile",
  owner: owner(),
  artifactKinds: ["solution"],
  fields: [{ name: "category", type: "string", indexed: true, filterable: true }],
  validators: [{
    id: "fixture.validator",
    async validate(context, request) {
      seen.push(context);
      return request.artifact.frontmatter.category ? { outcome: "valid" } : {
        outcome: "invalid",
        issues: [{ code: "category_missing", field: "category", summary: "Category is required." }],
      };
    },
  }],
});
const searchService = (id, packageName = `@fixture/${id}`) => ({
  contractVersion: 1,
  id,
  kind: "artifact-search-service",
  owner: owner(packageName, `/fixture/${id}`),
  async search() { throw new Error("not exercised"); },
});

function reset() {
  for (const key of [ARTIFACT_PROFILE_REGISTRY_KEY_V1, ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1, TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1]) {
    delete globalThis[Symbol.for(key)];
  }
}
test.afterEach(reset);

test("provider-before-consumer and consumer-before-provider resolve fresh profile snapshots", () => {
  const firstScope = {};
  createArtifactProfileRegistryV1().register(firstScope, profile());
  assert.equal(resolveArtifactProfilesV1(firstScope, createArtifactProfileRegistryV1()).outcome, "available");

  reset();
  const secondScope = {};
  const consumer = createArtifactProfileRegistryV1();
  assert.equal(resolveArtifactProfilesV1(secondScope, consumer).outcome, "missing");
  createArtifactProfileRegistryV1().register(secondScope, profile());
  const resolved = resolveArtifactProfilesV1(secondScope, consumer);
  assert.equal(resolved.outcome, "available");
  assert.equal(Object.isFrozen(resolved.records), true);
  assert.equal(Object.isFrozen(resolved.records[0].fields), true);
});

test("service resolution diagnoses missing, incompatible, duplicate, and conflicting IDs", () => {
  const scope = {};
  const registry = createArtifactSearchServiceRegistryV1();
  assert.equal(resolveArtifactSearchServiceV1(scope, registry).code, "missing_registration");
  const future = createCapabilityRegistry({ registryKey: ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1, contractVersion: 2 });
  future.register(scope, { contractVersion: 2, id: "future", owner: { packageName: "@fixture/future", packageRoot: "/future" } });
  const incompatibleResolution = resolveArtifactSearchServiceV1(scope, registry);
  assert.equal(incompatibleResolution.code, "incompatible_contract");
  assert.deepEqual(incompatibleResolution.providerIds, ["future"]);
  assert.equal(JSON.stringify(incompatibleResolution.catalog).includes("packageRoot"), false);

  registry.register(scope, searchService("service.a"));
  registry.register(scope, searchService("service.b"));
  assert.equal(resolveArtifactSearchServiceV1(scope, registry).code, "duplicate_registration");
  assert.throws(
    () => registry.register(scope, { ...searchService("service.a"), owner: owner("@fixture/conflict", "/conflict") }),
    (error) => isRegistryError(error, "PROVIDER_ID_CONFLICT"),
  );
});

test("profile validators receive fresh execution contexts", async () => {
  const seen = [];
  const validator = profile("fixture.profile", seen).validators[0];
  const request = (signal) => ({
    operation: "index",
    workspaceRoot: "/fixture",
    artifact: { path: "/fixture/solution.md", kind: "solution", frontmatter: { category: "physics" } },
    signal,
  });
  const oneController = new AbortController();
  const twoController = new AbortController();
  const one = Object.freeze({ cwd: "/one", signal: oneController.signal });
  const two = Object.freeze({ cwd: "/two", signal: twoController.signal });
  assert.equal((await validator.validate(one, request(one.signal))).outcome, "valid");
  assert.equal((await validator.validate(two, request(two.signal))).outcome, "valid");
  assert.deepEqual(seen, [one, two]);
  assert.notEqual(one.signal, two.signal);
  oneController.abort();
  assert.equal(one.signal.aborted, true);
  assert.equal(two.signal.aborted, false);
});

test("todo lifecycle request validator exhaustively enforces every operation branch", () => {
  const valid = [
    { operation: "inspect", workspaceRoot: "/repo", todosRoot: "/repo/todos", path: "/repo/todos/001-pending-p2-task.md" },
    { operation: "list", workspaceRoot: "/repo" },
    { operation: "allocate_id", workspaceRoot: "/repo", todosRoot: "/repo/todos", expectedDirectoryHash: hash("a") },
    {
      operation: "create", workspaceRoot: "/repo", todosRoot: "/repo/todos", expectedDirectoryHash: hash("b"), exclusive: true,
      todo: { title: "Task", priority: "p2", status: "ready", body: "Body", frontmatter: { tags: ["fixture"] } },
    },
    {
      operation: "transition", workspaceRoot: "/repo", todosRoot: "/repo/todos", path: "/repo/todos/001-pending-p2-task.md",
      toStatus: "complete", expectedContentHash: hash("c"),
    },
  ];
  for (const request of valid) {
    const before = structuredClone(request);
    assert.doesNotThrow(() => assertTodoLifecycleRequestV1(request));
    assert.deepEqual(request, before);
  }

  const malformed = [
    {},
    { operation: "future", workspaceRoot: "/repo" },
    { operation: "list", workspaceRoot: "relative" },
    { operation: "list", workspaceRoot: "/repo", todosRoot: 1 },
    { operation: "inspect", workspaceRoot: "/repo", path: "relative.md" },
    { operation: "inspect", workspaceRoot: "/repo", exclusive: true },
    { operation: "allocate_id", workspaceRoot: "/repo", expectedDirectoryHash: "sha256:short" },
    { operation: "allocate_id", workspaceRoot: "/repo", path: "/repo/todos/001.md" },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p2", body: "Body" }, exclusive: false },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "", priority: "p2", body: "Body" }, exclusive: true },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p4", body: "Body" }, exclusive: true },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p2", status: "later", body: "Body" }, exclusive: true },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p2", body: 1 }, exclusive: true },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p2", body: "Body", frontmatter: [] }, exclusive: true },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p2", body: "Body", frontmatter: new Date(0) }, exclusive: true },
    { operation: "create", workspaceRoot: "/repo", todo: { title: "Task", priority: "p2", body: "Body", unknown: true }, exclusive: true },
    { operation: "transition", workspaceRoot: "/repo", path: "/repo/todos/001.md", toStatus: "complete" },
    { operation: "transition", workspaceRoot: "/repo", path: "/repo/todos/001.md", toStatus: "later", expectedContentHash: hash("d") },
    { operation: "transition", workspaceRoot: "/repo", path: "/repo/todos/001.md", toStatus: "ready", expectedContentHash: hash("d"), exclusive: true },
  ];
  for (const request of malformed) assert.throws(() => assertTodoLifecycleRequestV1(request));
});

test("todo lifecycle result validator enforces every outcome and nested field", () => {
  const todo = { issueId: 1, renderedId: "001", status: "pending", priority: "p2", path: "/repo/todos/001-pending-p2-task.md", contentHash: hash("d") };
  const issue = { code: "fixture_issue", summary: "Fixture issue." };
  const valid = [
    { outcome: "inspected", state: "valid", todo, issues: [] },
    { outcome: "listed", todos: [todo], issues: [{ ...issue, path: "/repo/todos/bad.md" }] },
    { outcome: "allocated", issueId: 2, renderedId: "002", directoryHash: hash("e") },
    { outcome: "allocated", issueId: 1234, renderedId: "1234", directoryHash: hash("e") },
    { outcome: "created", todo },
    { outcome: "transitioned", todo, previousPath: "/repo/todos/001-ready-p2-task.md" },
    { outcome: "conflict", code: "content_changed", summary: "Content changed.", currentContentHash: hash("f") },
    { outcome: "blocked", code: "write_denied", summary: "Write denied." },
  ];
  for (const result of valid) {
    const before = structuredClone(result);
    assert.doesNotThrow(() => assertTodoLifecycleResultV1(result));
    assert.deepEqual(result, before);
  }
  for (const result of [
    { outcome: "created" },
    { outcome: "created", todo, currentContentHash: hash("a") },
    { outcome: "allocated", issueId: 1 },
    { outcome: "allocated", issueId: 0, renderedId: "000", directoryHash: hash("a") },
    { outcome: "allocated", issueId: 1, renderedId: "01", directoryHash: hash("a") },
    { outcome: "allocated", issueId: 2, renderedId: "001", directoryHash: hash("a") },
    { outcome: "allocated", issueId: 1, renderedId: "001", directoryHash: "not-a-hash" },
    { outcome: "listed", todos: [{ ...todo, status: "later" }], issues: [] },
    { outcome: "listed", todos: [{ ...todo, priority: "p4" }], issues: [] },
    { outcome: "listed", todos: [{ ...todo, path: "relative.md" }], issues: [] },
    { outcome: "listed", todos: [{ ...todo, contentHash: "sha256:short" }], issues: [] },
    { outcome: "listed", todos: [{ ...todo, extra: true }], issues: [] },
    { outcome: "listed", todos: [todo], issues: [{ ...issue, path: "relative.md" }] },
    { outcome: "inspected", state: "valid", issues: [{ code: "bad" }] },
    { outcome: "inspected", state: "valid", todo: undefined, issues: [] },
    { outcome: "inspected", state: "valid", issues: [{ ...issue, path: "/repo/todos/bad.md" }] },
    { outcome: "conflict", code: "bad code", summary: "Conflict." },
    { outcome: "blocked", code: "blocked", summary: "Blocked.", currentContentHash: undefined },
    { outcome: "future", code: "future", summary: "Future." },
  ]) assert.throws(() => assertTodoLifecycleResultV1(result));
});

test("todo path helpers enforce cross-platform lexical roots and canonical filenames", () => {
  const posix = resolveTodoPathContextV1("/repo");
  assert.deepEqual(posix, { workspaceRoot: "/repo", todosRoot: "/repo/todos", style: "posix" });
  assert.deepEqual(resolveTodoPathContextV1("/"), { workspaceRoot: "/", todosRoot: "/todos", style: "posix" });
  assert.equal(assertTodoPathContainedV1("/repo/001-pending-p2-task.md", resolveTodoPathContextV1("/workspace", "/")), "/repo/001-pending-p2-task.md");
  assert.equal(canonicalizeTodoAbsolutePathV1("/repo//todos/001-pending-p2-task.md"), "/repo/todos/001-pending-p2-task.md");
  assert.equal(assertTodoPathContainedV1("/repo/todos/nested/001-pending-p2-task.md", posix), "/repo/todos/nested/001-pending-p2-task.md");
  assert.throws(() => canonicalizeTodoAbsolutePathV1("/repo/todos/../outside.md"), /traversal/);
  assert.throws(() => assertTodoPathContainedV1("/repo/todos-other/001-pending-p2-task.md", posix), /contained/);

  const drive = resolveTodoPathContextV1("c:/Repo", "C:\\Repo\\Todos");
  assert.deepEqual(drive, { workspaceRoot: "C:\\Repo", todosRoot: "C:\\Repo\\Todos", style: "windows-drive" });
  assert.equal(assertTodoPathContainedV1("c:/repo/todos/001-pending-p2-task.md", drive), "C:\\repo\\todos\\001-pending-p2-task.md");
  assert.throws(() => assertTodoPathContainedV1("D:\\Repo\\Todos\\001-pending-p2-task.md", drive), /contained/);

  const unc = resolveTodoPathContextV1("\\\\server\\share\\workspace");
  assert.deepEqual(unc, {
    workspaceRoot: "\\\\server\\share\\workspace",
    todosRoot: "\\\\server\\share\\workspace\\todos",
    style: "windows-unc",
  });
  assert.equal(assertTodoPathContainedV1("//SERVER/share/workspace/todos/001-pending-p2-task.md", unc), "\\\\SERVER\\share\\workspace\\todos\\001-pending-p2-task.md");
  assert.throws(() => resolveTodoPathContextV1("/repo", "C:\\repo\\todos"), /same path style/);

  assert.deepEqual(parseCanonicalTodoBasenameV1("1000-ready-p1-large-id.md"), {
    basename: "1000-ready-p1-large-id.md", issueId: 1000, renderedId: "1000", status: "ready", priority: "p1", description: "large-id",
  });
  for (const basename of [
    "001-pending-p2.md", "001-pending-p2-Bad.md", "000-pending-p2-task.md", "0001-pending-p2-task.md",
    "001-completed-p2-task.md", "001-pending-p4-task.md", "001-pending-p2-task.txt",
  ]) assert.throws(() => parseCanonicalTodoBasenameV1(basename));
  assert.equal(todoPathCollisionKeyV1("/repo/todos/Group/001-pending-p2-task.md"), todoPathCollisionKeyV1("/repo//todos/group/001-pending-p2-task.md"));
});

test("todo request paths are canonical, root-contained, and nonmutating", () => {
  const valid = [
    { operation: "inspect", workspaceRoot: "/repo", path: "/repo/todos/001-pending-p2-task.md" },
    { operation: "inspect", workspaceRoot: "C:\\repo", path: "c:/repo/todos/1000-ready-p1-large-id.md" },
    { operation: "inspect", workspaceRoot: "\\\\server\\share\\repo", path: "//server/share/repo/todos/001-pending-p2-task.md" },
  ];
  for (const request of valid) {
    const before = structuredClone(request);
    assert.doesNotThrow(() => assertTodoLifecycleRequestV1(request));
    assert.deepEqual(request, before);
  }
  for (const request of [
    { operation: "inspect", workspaceRoot: "/repo", path: "/repo/todos/../outside/001-pending-p2-task.md" },
    { operation: "inspect", workspaceRoot: "/repo", path: "/repo/other/001-pending-p2-task.md" },
    { operation: "inspect", workspaceRoot: "/repo", path: "/repo/todos/001-ready-p2.md" },
    { operation: "list", workspaceRoot: "/repo", path: "/repo/todos/001-pending-p2-task.md" },
    { operation: "transition", workspaceRoot: "/repo", path: "/repo/todos/001-pending-p2-task.md", toStatus: "pending", expectedContentHash: hash() },
  ]) assert.throws(() => assertTodoLifecycleRequestV1(request));
});

test("todo identity validation binds filenames and rejects duplicate IDs and path collisions", () => {
  const makeTodo = (overrides = {}) => ({
    issueId: 1, renderedId: "001", status: "pending", priority: "p2",
    path: "/repo/todos/001-pending-p2-task.md", contentHash: hash("1"), ...overrides,
  });
  assert.doesNotThrow(() => assertTodoLifecycleResultV1({ outcome: "listed", todos: [
    makeTodo(),
    makeTodo({ issueId: 1000, renderedId: "1000", path: "/repo/todos/1000-pending-p2-large-task.md" }),
  ], issues: [] }));
  for (const todo of [
    makeTodo({ issueId: 2 }),
    makeTodo({ renderedId: "0001" }),
    makeTodo({ status: "ready" }),
    makeTodo({ priority: "p1" }),
    makeTodo({ path: "/repo/todos/001-pending-p2-other.md", issueId: 2, renderedId: "002" }),
  ]) assert.throws(() => assertTodoLifecycleResultV1({ outcome: "listed", todos: [todo], issues: [] }));

  assert.throws(() => assertTodoLifecycleResultV1({ outcome: "listed", todos: [
    makeTodo(), makeTodo({ path: "/repo/todos/001-pending-p2-other.md", contentHash: hash("2") }),
  ], issues: [] }), /duplicate issueId/);
  assert.throws(() => assertTodoLifecycleResultV1({ outcome: "listed", todos: [
    makeTodo({ path: "/repo/todos/Group/001-pending-p2-task.md" }),
    makeTodo({ path: "/repo/todos/group/001-pending-p2-task.md", contentHash: hash("2") }),
  ], issues: [] }), /path collision/);
});

test("todo create frontmatter cannot shadow canonical identity metadata", () => {
  assert.deepEqual(TODO_CANONICAL_FRONTMATTER_KEYS_V1, ["issue_id", "status", "priority"]);
  assert(TODO_FORBIDDEN_FRONTMATTER_KEYS_V1.includes("content_hash"));
  const request = (frontmatter, todoOverrides = {}) => ({
    operation: "create", workspaceRoot: "/repo", exclusive: true,
    todo: { title: "Task", status: "ready", priority: "p2", body: "Body", frontmatter, ...todoOverrides },
  });
  for (const frontmatter of [
    { status: "ready", priority: "p2", tags: ["fixture"], custom_data: { count: 1 } },
    Object.assign(Object.create(null), { tags: [] }),
  ]) assert.doesNotThrow(() => assertTodoLifecycleRequestV1(request(frontmatter)));

  for (const frontmatter of [
    { issue_id: 1 }, { "issue-id": 1 }, { id: 1 }, { renderedId: "001" }, { path: "/tmp/x" },
    { "content-hash": hash() }, { title: "Injected" }, { status: "pending" }, { priority: "p1" },
    { Status: "ready" }, { fooBar: 1, foo_bar: 1 }, { "content.hash": hash() }, { tags: undefined }, { when: new Date(0) },
  ]) assert.throws(() => assertTodoLifecycleRequestV1(request(frontmatter)));
  const accessor = {};
  Object.defineProperty(accessor, "tags", { enumerable: true, get() { throw new Error("must not be invoked"); } });
  assert.throws(() => assertTodoLifecycleRequestV1(request(accessor)), /data property/);
  const symbols = { tags: [] };
  symbols[Symbol("hidden")] = "value";
  assert.throws(() => assertTodoLifecycleRequestV1(request(symbols)), /symbol keys/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => assertTodoLifecycleRequestV1(request(cyclic)), /cycles/);
});

test("contextual lifecycle validation correlates every operation/result pairing", () => {
  const pending = { issueId: 1, renderedId: "001", status: "pending", priority: "p2", path: "/repo/todos/001-pending-p2-task.md", contentHash: hash("1") };
  const complete = { ...pending, status: "complete", path: "/repo/todos/001-complete-p2-task.md", contentHash: hash("2") };
  const created = { issueId: 2, renderedId: "002", status: "ready", priority: "p1", path: "/repo/todos/002-ready-p1-new-task.md", contentHash: hash("3") };
  const requests = {
    inspect: { operation: "inspect", workspaceRoot: "/repo", path: pending.path },
    list: { operation: "list", workspaceRoot: "/repo" },
    allocate_id: { operation: "allocate_id", workspaceRoot: "/repo" },
    create: { operation: "create", workspaceRoot: "/repo", exclusive: true, todo: { title: "New task", status: "ready", priority: "p1", body: "Body" } },
    transition: { operation: "transition", workspaceRoot: "/repo", path: pending.path, toStatus: "complete", expectedContentHash: pending.contentHash },
  };
  const results = {
    inspected: { outcome: "inspected", state: "valid", todo: pending, issues: [] },
    listed: { outcome: "listed", todos: [pending], issues: [] },
    allocated: { outcome: "allocated", issueId: 2, renderedId: "002", directoryHash: hash("4") },
    created: { outcome: "created", todo: created },
    transitioned: { outcome: "transitioned", todo: complete, previousPath: pending.path },
  };
  const allowed = { inspect: "inspected", list: "listed", allocate_id: "allocated", create: "created", transition: "transitioned" };
  for (const [operation, request] of Object.entries(requests)) {
    for (const [outcome, result] of Object.entries(results)) {
      const beforeRequest = structuredClone(request);
      const beforeResult = structuredClone(result);
      if (outcome === allowed[operation]) assert.doesNotThrow(() => assertTodoLifecycleResultForRequestV1(result, request));
      else assert.throws(() => assertTodoLifecycleResultForRequestV1(result, request), new RegExp(`todo ${operation} cannot return`));
      assert.deepEqual(request, beforeRequest);
      assert.deepEqual(result, beforeResult);
    }
    assert.doesNotThrow(() => assertTodoLifecycleResultForRequestV1({ outcome: "blocked", code: "fixture", summary: "Fixture." }, request));
    assert.doesNotThrow(() => assertTodoLifecycleResultForRequestV1({ outcome: "conflict", code: "fixture", summary: "Fixture." }, request));
  }
});

test("contextual lifecycle validation rejects root, create, inspect, and transition mismatches", () => {
  const pending = { issueId: 1, renderedId: "001", status: "pending", priority: "p2", path: "/repo/todos/001-pending-p2-task.md", contentHash: hash("1") };
  const inspect = { operation: "inspect", workspaceRoot: "/repo", path: pending.path };
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "inspected", state: "valid", todo: { ...pending, path: "/repo/todos/001-pending-p2-other.md" }, issues: [] }, inspect), /requested path/);
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "inspected", state: "valid", todo: { ...pending, path: "/outside/001-pending-p2-task.md" }, issues: [] }, inspect), /todosRoot/);
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "listed", todos: [pending], issues: [{ path: "/outside/bad.md", code: "bad", summary: "Bad." }] }, { operation: "list", workspaceRoot: "/repo" }), /todosRoot/);

  const create = { operation: "create", workspaceRoot: "/repo", exclusive: true, todo: { title: "Task", status: "ready", priority: "p1", body: "Body" } };
  const created = { issueId: 2, renderedId: "002", status: "ready", priority: "p1", path: "/repo/todos/002-ready-p1-task.md", contentHash: hash("2") };
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "created", todo: { ...created, status: "pending", path: "/repo/todos/002-pending-p1-task.md" } }, create), /status/);
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "created", todo: { ...created, priority: "p2", path: "/repo/todos/002-ready-p2-task.md" } }, create), /priority/);
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "created", todo: { ...created, path: "/outside/002-ready-p1-task.md" } }, create), /todosRoot/);

  const transition = { operation: "transition", workspaceRoot: "/repo", path: pending.path, toStatus: "complete", expectedContentHash: pending.contentHash };
  const complete = { ...pending, status: "complete", path: "/repo/todos/001-complete-p2-task.md", contentHash: hash("3") };
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "transitioned", todo: complete, previousPath: "/repo/todos/001-ready-p2-task.md" }, transition), /previousPath/);
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "transitioned", todo: { ...complete, status: "ready", path: "/repo/todos/001-ready-p2-task.md" }, previousPath: pending.path }, transition), /toStatus/);
  assert.throws(() => assertTodoLifecycleResultForRequestV1({ outcome: "transitioned", todo: { ...complete, path: "/repo/todos/001-complete-p2-other.md" }, previousPath: pending.path }, transition), /only change/);
  assert.throws(() => assertTodoLifecycleResultV1({ outcome: "transitioned", todo: complete }), /previousPath|object/);
  assert.throws(() => assertTodoLifecycleResultV1({ outcome: "created", todo: created, previousPath: pending.path }), /not allowed/);
});

test("todo conformance rejects malformed service/request before invocation", async () => {
  let calls = 0;
  const execute = async () => { calls += 1; return { outcome: "blocked", code: "fixture", summary: "Fixture." }; };
  await assert.rejects(assertTodoLifecycleServiceConformanceV1({
    contractVersion: 1, id: "todo.bad", kind: "wrong-kind", owner: owner(), execute,
  }, { operation: "list", workspaceRoot: "/repo" }));
  assert.equal(calls, 0);
  await assert.rejects(assertTodoLifecycleServiceConformanceV1({
    contractVersion: 1, id: "todo.good", kind: "todo-lifecycle-service", owner: owner(), execute,
  }, { operation: "inspect", workspaceRoot: "/repo", path: "/outside/001-pending-p2-task.md" }));
  assert.equal(calls, 0);
});

test("runtime service conformance validates results and isolated invocation cancellation", async () => {
  const searchSeen = [];
  const fakeSearch = {
    contractVersion: 1,
    id: "artifact-search.fixture",
    kind: "artifact-search-service",
    owner: owner(),
    async search(context) {
      searchSeen.push(context.signal);
      if (context.requestId === "cancellation-0") {
        await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
      } else if (context.requestId === "cancellation-1") {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return {
        text: "ok",
        details: {},
        provenance: {
          schema: "@aefree/pi-project-artifacts/execution-provenance",
          version: 1,
          canonical: { serviceId: "artifact-search.fixture", packageName: "@fixture/artifacts", packageVersion: "1.0.0", contractVersion: 1 },
          profiles: [], fallbacks: [], executionGate: "executed",
        },
      };
    },
  };
  const todoSeen = [];
  const fakeTodo = {
    contractVersion: 1,
    id: "todo.fixture",
    kind: "todo-lifecycle-service",
    owner: owner(),
    async execute(context) {
      todoSeen.push(context.signal);
      if (context.requestId === "cancellation-0") {
        await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
      } else if (context.requestId === "cancellation-1") {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { outcome: "blocked", code: "fixture_blocked", summary: "Fixture only." };
    },
  };
  const searchReport = await assertArtifactSearchServiceConformanceV1(fakeSearch, { query: "needle" }, { watchdogMs: 100 });
  const todoReport = await assertTodoLifecycleServiceConformanceV1(fakeTodo, { operation: "list", workspaceRoot: "/fixture" }, { watchdogMs: 100 });
  assert(searchReport.checks.includes("in-flight cooperative cancellation"));
  assert(todoReport.checks.includes("sibling isolation"));
  assert.notEqual(searchSeen[1], searchSeen[2]);
  assert.equal(searchSeen[1].aborted, true);
  assert.equal(searchSeen[2].aborted, false);
  assert.notEqual(todoSeen[1], todoSeen[2]);
  assert.equal(todoSeen[1].aborted, true);
  assert.equal(todoSeen[2].aborted, false);
});

test("todo service conformance rejects malformed lifecycle result branches", async () => {
  const malformedResults = [
    { outcome: "allocated", issueId: 7, renderedId: "008", directoryHash: hash("a") },
    { outcome: "created", todo: { issueId: 1, renderedId: "001", status: "pending", priority: "p2", path: "/repo/todos/001.md", contentHash: "bad" } },
    { outcome: "blocked", code: "blocked", summary: "Blocked.", currentContentHash: 42 },
  ];
  for (const malformedResult of malformedResults) {
    const service = {
      contractVersion: 1,
      id: "todo.malformed",
      kind: "todo-lifecycle-service",
      owner: owner(),
      async execute() { return malformedResult; },
    };
    await assert.rejects(assertTodoLifecycleServiceConformanceV1(service, { operation: "list", workspaceRoot: "/fixture" }));
  }
});

test("artifact-profile conformance helper is reusable", async () => {
  const nestedSignals = [];
  const report = await assertArtifactProfileConformanceV1({
    createProfile: () => {
      const subject = profile();
      const validator = subject.validators[0];
      return {
        ...subject,
        validators: [{
          ...validator,
          async validate(context, request) {
            nestedSignals.push([context.signal, request.signal]);
            if (context.requestId === "cancellation-0") {
              await new Promise((resolve) => request.signal.addEventListener("abort", resolve, { once: true }));
            } else if (context.requestId === "cancellation-1") {
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            return await validator.validate(context, request);
          },
        }],
        async appliesTo(context, request) {
          nestedSignals.push([context.signal, request.signal]);
          if (context.requestId === "cancellation-0") {
            await new Promise((resolve) => request.signal.addEventListener("abort", resolve, { once: true }));
          } else if (context.requestId === "cancellation-1") {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          return true;
        },
      };
    },
    validArtifact: { path: "/fixture/valid.md", kind: "solution", frontmatter: { category: "physics" } },
    invalidArtifact: { path: "/fixture/invalid.md", kind: "solution", frontmatter: {} },
  });
  assert.equal(report.passed, true);
  assert(report.checks.includes("invalid fixture"));
  assert(report.checks.includes("profile applicability"));
  assert(report.checks.includes("validator in-flight cancellation"));
  assert(report.checks.includes("applicability sibling isolation"));
  assert(nestedSignals.every(([contextSignal, requestSignal]) => contextSignal === requestSignal));
});

test("exported artifact conformance helpers reject deliberately non-cooperative callbacks", async () => {
  const never = new Promise(() => {});
  const result = {
    text: "ok", details: {}, provenance: {
      schema: "@aefree/pi-project-artifacts/execution-provenance", version: 1,
      canonical: { serviceId: "artifact-search.bad", packageName: "@fixture/artifacts", packageVersion: "1.0.0", contractVersion: 1 },
      profiles: [], fallbacks: [], executionGate: "executed",
    },
  };
  const badSearch = {
    contractVersion: 1, id: "artifact-search.bad", kind: "artifact-search-service", owner: owner(),
    async search(context) { return context.requestId === "cancellation-0" ? await never : result; },
  };
  await assert.rejects(assertArtifactSearchServiceConformanceV1(badSearch, { query: "needle" }, { watchdogMs: 20 }), /did not settle or explicitly observe abort/);

  const badTodo = {
    contractVersion: 1, id: "todo.bad", kind: "todo-lifecycle-service", owner: owner(),
    async execute(context) { return context.requestId === "cancellation-0" ? await never : { outcome: "blocked", code: "fixture", summary: "Fixture." }; },
  };
  await assert.rejects(assertTodoLifecycleServiceConformanceV1(badTodo, { operation: "list", workspaceRoot: "/fixture" }, { watchdogMs: 20 }), /did not settle or explicitly observe abort/);

  await assert.rejects(assertArtifactProfileConformanceV1({
    createProfile: () => {
      const subject = profile();
      return { ...subject, validators: [{ ...subject.validators[0], async validate(context, request) {
        return context.requestId === "cancellation-0" ? await never : subject.validators[0].validate(context, request);
      } }] };
    },
    validArtifact: { path: "/fixture/valid.md", kind: "solution", frontmatter: { category: "physics" } },
  }, { watchdogMs: 20 }), /did not settle or explicitly observe abort/);

  await assert.rejects(assertArtifactProfileConformanceV1({
    createProfile: () => ({ ...profile(), async appliesTo(context) {
      return context.requestId === "cancellation-0" ? await never : true;
    } }),
    validArtifact: { path: "/fixture/valid.md", kind: "solution", frontmatter: { category: "physics" } },
  }, { watchdogMs: 20 }), /Artifact applicability conformance: aborted invocation did not settle/);
});

test("in-flight artifact validators receive and isolate invocation cancellation", async () => {
  const requestSignals = [];
  const validator = {
    async validate(_context, request) {
      requestSignals.push(request.signal);
      return await new Promise((resolve) => {
        request.signal.addEventListener("abort", () => resolve({ outcome: "valid" }), { once: true });
      });
    },
  };
  const artifact = { path: "/fixture/solution.md", kind: "solution", frontmatter: { category: "physics" } };
  const first = new AbortController();
  const second = new AbortController();
  const firstRun = validator.validate({ cwd: "/first", signal: first.signal }, {
    operation: "index", workspaceRoot: "/fixture", artifact, signal: first.signal,
  });
  const secondRun = validator.validate({ cwd: "/second", signal: second.signal }, {
    operation: "index", workspaceRoot: "/fixture", artifact, signal: second.signal,
  });
  assert.equal(requestSignals[0], first.signal);
  assert.equal(requestSignals[1], second.signal);
  first.abort();
  assert.deepEqual(await firstRun, { outcome: "valid" });
  assert.equal(requestSignals[0].aborted, true);
  assert.equal(requestSignals[1].aborted, false);
  second.abort();
  await secondRun;
});
