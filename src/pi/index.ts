import { StringEnum } from "@earendil-works/pi-ai";
import { withFileMutationQueue, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import type { RegistrationToken } from "@aefree/pi-capability-registry";
import {
  createArtifactSearchServiceRegistryV1,
  createTodoLifecycleServiceRegistryV1,
  resolveArtifactSearchServiceV1,
  resolveTodoLifecycleServiceV1,
  parseCanonicalTodoPathV1,
  type ArtifactExecutionContextV1,
  type ArtifactSearchRequestV1,
  type TodoLifecycleRequestV1,
} from "../contracts/v1/index.js";
import { createArtifactSearchServiceV1, createTodoLifecycleServiceV1 } from "../core/services.js";
import { bindArtifactExecutionScopeV1 } from "../core/execution-context.js";
import { trackArtifactToolResult } from "../core/artifact-index.js";
import { ProjectArtifactError } from "../core/errors.js";
import { registerProjectArtifactLegacyReferencesV1 } from "../core/legacy-reference.js";

const STRING_OR_ARRAY = Type.Union([Type.String(), Type.Array(Type.String())]);
const FILTER_VALUES = Type.Union([Type.String(), Type.Array(Type.String())]);
const SEARCH_PARAMETERS = Type.Object({
  query: Type.Optional(Type.String({ description: "Plain-text search query. Quoted phrases are treated as one term." })),
  requiredTerms: Type.Optional(STRING_OR_ARRAY),
  optionalTerms: Type.Optional(STRING_OR_ARRAY),
  searchFields: Type.Optional(Type.Array(StringEnum(["path", "title", "tags", "frontmatter", "headings", "body"] as const))),
  workspaceRoot: Type.Optional(Type.String({ description: "Workspace root. Defaults to the current Pi cwd." })),
  docsRoot: Type.Optional(Type.String({ description: "Docs root, absolute or workspace-relative. Defaults to docs." })),
  todosRoot: Type.Optional(Type.String({ description: "Todos root, absolute or workspace-relative. Defaults to todos." })),
  indexPath: Type.Optional(Type.String({ description: "Disposable canonical index path. Defaults under .pi-project-artifacts/index-v1*.json and must remain physically inside the workspace." })),
  scopes: Type.Optional(Type.Array(StringEnum(["all", "docs", "solutions", "plans", "todos"] as const))),
  filters: Type.Optional(Type.Record(Type.String(), FILTER_VALUES, { description: "Exact frontmatter filters. Profile-defined fields require the compatible profile package." })),
  rankProfile: Type.Optional(StringEnum(["balanced", "frontmatter", "recency", "todos"] as const)),
  matchMode: Type.Optional(StringEnum(["all", "any", "phrase"] as const)),
  minTermMatches: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  maxSnippetChars: Type.Optional(Type.Integer({ minimum: 60, maximum: 1000, default: 220 })),
  includeBody: Type.Optional(Type.Boolean({ default: true })),
  includeCompletedTodos: Type.Optional(Type.Boolean({ default: true })),
  includeRelated: Type.Optional(Type.Boolean({ default: false })),
  relatedLimit: Type.Optional(Type.Integer({ minimum: 0, maximum: 20, default: 5 })),
  groupByKind: Type.Optional(Type.Boolean({ default: false })),
  freshnessMode: Type.Optional(StringEnum(["auto", "strict", "memory"] as const)),
  freshnessTtlMs: Type.Optional(Type.Integer({ minimum: 0, default: 30000 })),
  outputMode: Type.Optional(StringEnum(["compact", "detailed"] as const)),
  explain: Type.Optional(Type.Boolean({ default: false })),
  rebuild: Type.Optional(Type.Boolean({ default: false })),
});
const ROOT_PARAMETERS = {
  workspaceRoot: Type.Optional(Type.String({ description: "Workspace root. Defaults to the current Pi cwd." })),
  todosRoot: Type.Optional(Type.String({ description: "Todos root, absolute or workspace-relative. Defaults to todos." })),
};

export default function registerProjectArtifacts(pi: ExtensionAPI): void {
  const searchRegistry = createArtifactSearchServiceRegistryV1();
  const todoRegistry = createTodoLifecycleServiceRegistryV1();
  let searchToken: RegistrationToken | undefined;
  let todoToken: RegistrationToken | undefined;
  let legacyReferences: Readonly<{ token: RegistrationToken; unregister(): boolean }> | undefined;
  let activeScope: object | undefined;

  pi.on("session_start", (_event, ctx) => {
    // Reloading replaces only this extension's old registrations. The service
    // itself never closes over the old scope.
    if (searchToken) searchRegistry.unregister(searchToken);
    if (todoToken) todoRegistry.unregister(todoToken);
    legacyReferences?.unregister();
    const scope = ctx.sessionManager;
    searchToken = searchRegistry.register(scope, createArtifactSearchServiceV1());
    todoToken = todoRegistry.register(scope, createTodoLifecycleServiceV1());
    legacyReferences = registerProjectArtifactLegacyReferencesV1(scope);
    activeScope = scope;
    pi.events.emit("pi-project-artifacts:services-changed", { scope, contractVersion: 1, action: "registered" });
  });
  pi.on("session_shutdown", (_event, ctx) => {
    // A delayed shutdown for a replaced session must not remove the current
    // session's registrations.
    if (activeScope !== ctx.sessionManager) return;
    const searchChanged = searchRegistry.unregister(searchToken);
    const todoChanged = todoRegistry.unregister(todoToken);
    const legacyChanged = legacyReferences?.unregister() ?? false;
    searchToken = undefined;
    todoToken = undefined;
    legacyReferences = undefined;
    activeScope = undefined;
    if (searchChanged || todoChanged || legacyChanged) pi.events.emit("pi-project-artifacts:services-changed", { scope: ctx.sessionManager, contractVersion: 1, action: "unregistered" });
  });
  pi.on("tool_result", (event, ctx) => { trackArtifactToolResult(event, path.resolve(ctx.cwd)); });

  pi.registerTool({
    name: "project_artifact_search",
    label: "Search Project Artifacts",
    description: "Search project-local Markdown docs and todos through the canonical disposable .pi-project-artifacts index. Generic unfiltered search works without optional profiles; profile-defined filters fail explicitly when their provider is missing.",
    promptSnippet: "Search project Markdown docs and file todos through the canonical project artifact service.",
    promptGuidelines: [
      "Use project_artifact_search for structured project docs/todo discovery; authoritative Markdown remains the source of truth.",
      "Use project_artifact_search filters only for generic fields or fields disclosed by an installed artifact profile; missing profile-defined filters block rather than guessing.",
      "Do not edit .pi-project-artifacts indexes manually; they are disposable derived state.",
    ],
    parameters: SEARCH_PARAMETERS,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Refreshing canonical project artifact index..." }], details: {} });
      const service = requireSearchService(ctx);
      const result = await service.search(executionContext(ctx, signal, toolCallId), params as ArtifactSearchRequestV1);
      return { content: [{ type: "text", text: result.text }], details: { ...result.details, provenance: result.provenance } };
    },
  });

  registerTodoReadTool(pi, "project_todo_validate", "Validate File Todos", "Validate every Markdown todo and report canonical filename/frontmatter conflicts without mutation.", "list", ROOT_PARAMETERS);
  registerTodoReadTool(pi, "project_todo_list", "List File Todos", "List canonical file todos and diagnose malformed or conflicting pre-existing files without mutation.", "list", ROOT_PARAMETERS);
  registerTodoReadTool(pi, "project_todo_inspect", "Inspect File Todo", "Inspect one canonical file todo and compare filename identity with frontmatter without mutation.", "inspect", {
    ...ROOT_PARAMETERS,
    path: Type.String({ description: "Todo Markdown path, absolute or workspace-relative." }),
  });
  registerTodoReadTool(pi, "project_todo_allocate", "Allocate File Todo ID", "Read a conflict-free todos directory under lock and return its next numeric ID plus directory hash. Creation must still use project_todo_create.", "allocate_id", {
    ...ROOT_PARAMETERS,
    expectedDirectoryHash: Type.Optional(Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })),
  });

  pi.registerTool({
    name: "project_todo_create",
    label: "Create File Todo",
    description: "Create one canonical file todo with locked allocation, staging, exclusive target creation, hash verification, and rollback. Pre-existing conflicts block without repair.",
    promptSnippet: "Create one canonical file todo atomically from typed content.",
    promptGuidelines: ["Use project_todo_create instead of model-directed maximum-plus-one allocation or direct todo file writes."],
    parameters: Type.Object({
      ...ROOT_PARAMETERS,
      title: Type.String({ minLength: 1 }),
      priority: StringEnum(["p1", "p2", "p3"] as const),
      status: Type.Optional(StringEnum(["pending", "ready", "complete"] as const)),
      body: Type.String({ description: "Todo Markdown body. If no H1 exists, the title is added as the H1." }),
      frontmatter: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Additional data-only frontmatter. Canonical identity/path/hash keys are forbidden by the v1 contract." })),
      expectedDirectoryHash: Type.Optional(Type.String({ pattern: "^sha256:[a-f0-9]{64}$" })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const root = normalizedRootParams(ctx, params);
      const request: TodoLifecycleRequestV1 = {
        operation: "create", ...root,
        todo: { title: params.title, priority: params.priority, ...(params.status === undefined ? {} : { status: params.status }), body: params.body, ...(params.frontmatter === undefined ? {} : { frontmatter: params.frontmatter }) },
        ...(params.expectedDirectoryHash === undefined ? {} : { expectedDirectoryHash: params.expectedDirectoryHash }),
        exclusive: true,
      };
      return todoToolResult(await requireTodoService(ctx).execute(executionContext(ctx, signal), request));
    },
  });

  pi.registerTool({
    name: "project_todo_transition",
    label: "Transition File Todo",
    description: "Atomically change a canonical todo status in both filename and frontmatter using an expected content hash, exclusive destination creation, staging, and rollback.",
    promptSnippet: "Transition one canonical file todo with an expected hash.",
    promptGuidelines: ["Use project_todo_transition instead of separate rename and edit calls for file-todo status changes."],
    parameters: Type.Object({
      ...ROOT_PARAMETERS,
      path: Type.String(),
      toStatus: StringEnum(["pending", "ready", "complete"] as const),
      expectedContentHash: Type.String({ pattern: "^sha256:[a-f0-9]{64}$" }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const root = normalizedRootParams(ctx, params);
      const source = resolveTarget(root.workspaceRoot, params.path);
      const parsed = parseCanonicalTodoPathV1(source);
      const target = path.join(parsed.directory, `${parsed.renderedId}-${params.toStatus}-${parsed.priority}-${parsed.description}.md`);
      const request: TodoLifecycleRequestV1 = { operation: "transition", ...root, path: source, toStatus: params.toStatus, expectedContentHash: params.expectedContentHash };
      const [firstQueuePath, secondQueuePath] = [source, target].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
      return await withFileMutationQueue(firstQueuePath!, async () => await withFileMutationQueue(secondQueuePath!, async () => todoToolResult(await requireTodoService(ctx).execute(executionContext(ctx, signal), request))));
    },
  });
}

function registerTodoReadTool(pi: ExtensionAPI, name: string, label: string, description: string, operation: "list" | "inspect" | "allocate_id", fields: any): void {
  pi.registerTool({
    name,
    label,
    description,
    parameters: Type.Object(fields),
    async execute(_id, params: Record<string, unknown>, signal, _onUpdate, ctx) {
      const root = normalizedRootParams(ctx, params as { workspaceRoot?: string; todosRoot?: string });
      const request = operation === "list"
        ? { operation, ...root }
        : operation === "inspect"
          ? { operation, ...root, path: resolveTarget(root.workspaceRoot, String(params.path)) }
          : { operation, ...root, ...(params.expectedDirectoryHash === undefined ? {} : { expectedDirectoryHash: String(params.expectedDirectoryHash) }) };
      return todoToolResult(await requireTodoService(ctx).execute(executionContext(ctx, signal), request as TodoLifecycleRequestV1));
    },
  });
}
function requireSearchService(ctx: ExtensionContext) {
  const resolved = resolveArtifactSearchServiceV1(ctx.sessionManager);
  if (resolved.outcome !== "available") throw new ProjectArtifactError(resolved.code, "Canonical ArtifactSearchServiceV1 is unavailable. Install/enable @aefree/pi-project-artifacts and start a fresh session.", { registryKey: resolved.registryKey, providerIds: resolved.providerIds });
  return resolved.records[0]!;
}
function requireTodoService(ctx: ExtensionContext) {
  const resolved = resolveTodoLifecycleServiceV1(ctx.sessionManager);
  if (resolved.outcome !== "available") throw new ProjectArtifactError(resolved.code, "Canonical TodoLifecycleServiceV1 is unavailable. Install/enable @aefree/pi-project-artifacts and start a fresh session.", { registryKey: resolved.registryKey, providerIds: resolved.providerIds });
  return resolved.records[0]!;
}
function executionContext(ctx: ExtensionContext, signal: AbortSignal | undefined, requestId?: string): ArtifactExecutionContextV1 {
  const context = Object.freeze({ cwd: path.resolve(ctx.cwd), signal: signal ?? new AbortController().signal, ...(requestId === undefined ? {} : { requestId }) });
  return bindArtifactExecutionScopeV1(context, ctx.sessionManager);
}
function normalizedRootParams(ctx: ExtensionContext, params: { workspaceRoot?: string; todosRoot?: string }): { workspaceRoot: string; todosRoot?: string } {
  const workspaceRoot = params.workspaceRoot?.trim() ? resolveTarget(ctx.cwd, params.workspaceRoot) : path.resolve(ctx.cwd);
  return { workspaceRoot, ...(params.todosRoot?.trim() ? { todosRoot: resolveTarget(workspaceRoot, params.todosRoot) } : {}) };
}
function resolveTarget(base: string, value: string): string { const cleaned = value.trim().replace(/^@(?=[^@])/u, ""); return path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(base, cleaned); }
function todoToolResult(result: unknown) { const text = JSON.stringify(result, null, 2); return { content: [{ type: "text" as const, text }], details: { result, provenance: { canonical: { serviceId: "project-file-todos.v1", packageName: "@aefree/pi-project-artifacts", packageVersion: "0.1.0", contractVersion: 1 } } } }; }
