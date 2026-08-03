import {
  createCapabilityRegistry,
  type CapabilityRegistry,
  type RegistryOwner,
  type RegistryRecord,
  type VersionCatalog,
} from "@aefree/pi-capability-registry";
import { posix as posixPath, win32 as win32Path } from "node:path";

export const PROJECT_ARTIFACTS_CONTRACT_VERSION_V1 = 1 as const;
export const ARTIFACT_PROFILE_REGISTRY_KEY_V1 = "@aefree/pi-project-artifacts/profiles/v1" as const;
export const ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1 = "@aefree/pi-project-artifacts/search-services/v1" as const;
export const TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1 = "@aefree/pi-project-artifacts/todo-lifecycle-services/v1" as const;

export interface ArtifactOwnerV1 extends RegistryOwner {
  readonly packageVersion: string;
  readonly registeredBy: string;
}

export interface ArtifactExecutionContextV1 {
  readonly cwd: string;
  readonly requestId?: string;
  /** Invocation-owned cancellation. A fresh signal is required for every service call. */
  readonly signal: AbortSignal;
}

export interface ArtifactExecutionProvenanceV1 {
  readonly schema: "@aefree/pi-project-artifacts/execution-provenance";
  readonly version: 1;
  readonly canonical: {
    readonly serviceId: string;
    readonly packageName: string;
    readonly packageVersion: string;
    readonly contractVersion: 1;
  };
  readonly profiles: readonly {
    readonly profileId: string;
    readonly packageName: string;
    readonly packageVersion: string;
    readonly contractVersion: 1;
    readonly decision: "applied" | "not_applicable" | "blocked";
  }[];
  readonly fallbacks: readonly {
    readonly code: string;
    readonly action: "used" | "blocked" | "not_needed";
    readonly summary: string;
  }[];
  readonly executionGate: "executed" | "blocked";
}

export type ArtifactFieldTypeV1 = "string" | "string_list" | "integer" | "boolean" | "date";

export interface ArtifactFieldDefinitionV1 {
  readonly name: string;
  readonly type: ArtifactFieldTypeV1;
  readonly indexed: boolean;
  readonly filterable: boolean;
  readonly required?: boolean;
  readonly enumValues?: readonly string[];
}

export interface ArtifactCandidateV1 {
  readonly path: string;
  readonly kind: "doc" | "solution" | "plan" | "memory" | "todo" | "other";
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

export interface ArtifactValidationRequestV1 {
  readonly operation: "index" | "search" | "create" | "update";
  readonly workspaceRoot: string;
  readonly artifact: ArtifactCandidateV1;
  readonly signal: AbortSignal;
}

export type ArtifactValidationResultV1 =
  | { readonly outcome: "valid" }
  | {
      readonly outcome: "invalid" | "conflict";
      readonly issues: readonly {
        readonly code: string;
        readonly field?: string;
        readonly summary: string;
      }[];
    }
  | {
      readonly outcome: "unavailable" | "error";
      readonly code: string;
      readonly retryable: boolean;
    };

export interface ArtifactValidatorV1 {
  readonly id: string;
  validate(
    context: ArtifactExecutionContextV1,
    request: ArtifactValidationRequestV1,
  ): Promise<ArtifactValidationResultV1>;
}

export interface ArtifactProfileV1 extends RegistryRecord {
  readonly contractVersion: 1;
  readonly kind: "artifact-profile";
  readonly owner: ArtifactOwnerV1;
  readonly artifactKinds: readonly string[];
  readonly fields: readonly ArtifactFieldDefinitionV1[];
  readonly validators: readonly ArtifactValidatorV1[];
  /** Optional target-scoped applicability test; receives current execution context. */
  appliesTo?(
    context: ArtifactExecutionContextV1,
    request: { readonly workspaceRoot: string; readonly artifactPath?: string; readonly signal: AbortSignal },
  ): Promise<boolean>;
}

export interface ArtifactSearchRequestV1 {
  readonly query?: string;
  readonly requiredTerms?: string | readonly string[];
  readonly optionalTerms?: string | readonly string[];
  readonly searchFields?: readonly string[];
  readonly workspaceRoot?: string;
  readonly docsRoot?: string;
  readonly todosRoot?: string;
  readonly indexPath?: string;
  readonly scopes?: readonly string[];
  readonly filters?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rankProfile?: string;
  readonly matchMode?: "all" | "any" | "phrase";
  readonly minTermMatches?: number;
  readonly limit?: number;
  readonly maxSnippetChars?: number;
  readonly includeBody?: boolean;
  readonly includeCompletedTodos?: boolean;
  readonly includeRelated?: boolean;
  readonly relatedLimit?: number;
  readonly groupByKind?: boolean;
  readonly freshnessMode?: "auto" | "strict" | "memory";
  readonly freshnessTtlMs?: number;
  readonly outputMode?: "compact" | "detailed";
  readonly explain?: boolean;
  readonly rebuild?: boolean;
}

export interface ArtifactSearchResultV1 {
  readonly text: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly provenance: ArtifactExecutionProvenanceV1;
}

export interface ArtifactSearchServiceV1 extends RegistryRecord {
  readonly contractVersion: 1;
  readonly kind: "artifact-search-service";
  readonly owner: ArtifactOwnerV1;
  search(
    context: ArtifactExecutionContextV1,
    request: ArtifactSearchRequestV1,
  ): Promise<ArtifactSearchResultV1>;
}

export type TodoStatusV1 = "pending" | "ready" | "complete";
export type TodoPriorityV1 = "p1" | "p2" | "p3";
export type TodoPathStyleV1 = "posix" | "windows-drive" | "windows-unc";

/** Frontmatter fields owned by the canonical todo writer rather than caller metadata. */
export const TODO_CANONICAL_FRONTMATTER_KEYS_V1 = Object.freeze(["issue_id", "status", "priority"] as const);
/** Contract/runtime identity fields that caller-supplied frontmatter may never shadow. */
export const TODO_FORBIDDEN_FRONTMATTER_KEYS_V1 = Object.freeze([
  "id", "identity", "identity_id", "issue_id", "rendered_id", "title",
  "path", "previous_path", "file_path", "source_path", "target_path", "filename", "basename",
  "hash", "sha256", "identity_hash", "content_hash", "directory_hash", "expected_content_hash", "expected_directory_hash",
  "workspace_root", "todos_root",
] as const);

export interface TodoPathContextV1 {
  readonly workspaceRoot: string;
  readonly todosRoot: string;
  readonly style: TodoPathStyleV1;
}

export interface ParsedTodoBasenameV1 {
  readonly basename: string;
  readonly issueId: number;
  readonly renderedId: string;
  readonly status: TodoStatusV1;
  readonly priority: TodoPriorityV1;
  readonly description: string;
}

export interface ParsedTodoPathV1 extends ParsedTodoBasenameV1 {
  readonly path: string;
  readonly directory: string;
  readonly style: TodoPathStyleV1;
}

export interface TodoDocumentInputV1 {
  readonly title: string;
  readonly priority: TodoPriorityV1;
  readonly status?: TodoStatusV1;
  readonly body: string;
  readonly frontmatter?: Readonly<Record<string, unknown>>;
}

export type TodoLifecycleRequestV1 =
  | {
      readonly operation: "inspect";
      readonly workspaceRoot: string;
      readonly todosRoot?: string;
      readonly path: string;
    }
  | {
      readonly operation: "list";
      readonly workspaceRoot: string;
      readonly todosRoot?: string;
    }
  | {
      readonly operation: "allocate_id";
      readonly workspaceRoot: string;
      readonly todosRoot?: string;
      readonly expectedDirectoryHash?: string;
    }
  | {
      readonly operation: "create";
      readonly workspaceRoot: string;
      readonly todosRoot?: string;
      readonly todo: TodoDocumentInputV1;
      readonly expectedDirectoryHash?: string;
      readonly exclusive: true;
    }
  | {
      readonly operation: "transition";
      readonly workspaceRoot: string;
      readonly todosRoot?: string;
      readonly path: string;
      readonly toStatus: TodoStatusV1;
      readonly expectedContentHash: string;
    };

export interface TodoIdentityV1 {
  readonly issueId: number;
  readonly renderedId: string;
  readonly status: TodoStatusV1;
  readonly priority: TodoPriorityV1;
  readonly path: string;
  readonly contentHash: string;
}

export type TodoLifecycleResultV1 =
  | {
      readonly outcome: "inspected";
      readonly state: "valid" | "invalid" | "conflict";
      readonly todo?: TodoIdentityV1;
      readonly issues: readonly { readonly code: string; readonly summary: string }[];
    }
  | {
      readonly outcome: "listed";
      readonly todos: readonly TodoIdentityV1[];
      readonly issues: readonly { readonly path?: string; readonly code: string; readonly summary: string }[];
    }
  | {
      readonly outcome: "allocated";
      readonly issueId: number;
      readonly renderedId: string;
      readonly directoryHash: string;
    }
  | {
      readonly outcome: "created";
      readonly todo: TodoIdentityV1;
    }
  | {
      readonly outcome: "transitioned";
      readonly todo: TodoIdentityV1;
      readonly previousPath: string;
    }
  | {
      readonly outcome: "conflict" | "blocked";
      readonly code: string;
      readonly summary: string;
      readonly currentContentHash?: string;
    };

/** Deterministic lifecycle boundary. Existing conflicts are diagnosed, never auto-repaired. */
export interface TodoLifecycleServiceV1 extends RegistryRecord {
  readonly contractVersion: 1;
  readonly kind: "todo-lifecycle-service";
  readonly owner: ArtifactOwnerV1;
  execute(
    context: ArtifactExecutionContextV1,
    request: TodoLifecycleRequestV1,
  ): Promise<TodoLifecycleResultV1>;
}

export type ContractResolutionV1<TRecord extends RegistryRecord> =
  | { readonly outcome: "available"; readonly records: readonly Readonly<TRecord>[]; readonly catalog: VersionCatalog }
  | {
      readonly outcome: "missing" | "incompatible" | "duplicate";
      readonly code: "missing_registration" | "incompatible_contract" | "duplicate_registration";
      readonly expectedContractVersion: 1;
      readonly registryKey: string;
      readonly providerIds: readonly string[];
      readonly catalog: VersionCatalog;
    };

export function createArtifactProfileRegistryV1(): CapabilityRegistry<ArtifactProfileV1> {
  return createCapabilityRegistry({
    registryKey: ARTIFACT_PROFILE_REGISTRY_KEY_V1,
    contractVersion: PROJECT_ARTIFACTS_CONTRACT_VERSION_V1,
    compatibleVersions: [PROJECT_ARTIFACTS_CONTRACT_VERSION_V1],
    validate: assertArtifactProfileV1,
  });
}

export function createArtifactSearchServiceRegistryV1(): CapabilityRegistry<ArtifactSearchServiceV1> {
  return createCapabilityRegistry({
    registryKey: ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1,
    contractVersion: PROJECT_ARTIFACTS_CONTRACT_VERSION_V1,
    compatibleVersions: [PROJECT_ARTIFACTS_CONTRACT_VERSION_V1],
    validate: assertArtifactSearchServiceV1,
  });
}

export function createTodoLifecycleServiceRegistryV1(): CapabilityRegistry<TodoLifecycleServiceV1> {
  return createCapabilityRegistry({
    registryKey: TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1,
    contractVersion: PROJECT_ARTIFACTS_CONTRACT_VERSION_V1,
    compatibleVersions: [PROJECT_ARTIFACTS_CONTRACT_VERSION_V1],
    validate: assertTodoLifecycleServiceV1,
  });
}

export function resolveArtifactProfilesV1(scope: object, registry = createArtifactProfileRegistryV1()): ContractResolutionV1<ArtifactProfileV1> {
  return resolveContracts(scope, registry, false);
}

export function resolveArtifactSearchServiceV1(scope: object, registry = createArtifactSearchServiceRegistryV1()): ContractResolutionV1<ArtifactSearchServiceV1> {
  return resolveContracts(scope, registry, true);
}

export function resolveTodoLifecycleServiceV1(scope: object, registry = createTodoLifecycleServiceRegistryV1()): ContractResolutionV1<TodoLifecycleServiceV1> {
  return resolveContracts(scope, registry, true);
}

export function assertArtifactExecutionContextV1(value: unknown): asserts value is ArtifactExecutionContextV1 {
  const context = asObject(value, "ArtifactExecutionContextV1");
  assertNonEmpty(context.cwd, "ArtifactExecutionContextV1.cwd");
  if (context.requestId !== undefined) assertNonEmpty(context.requestId, "ArtifactExecutionContextV1.requestId");
  if (context.signal === null || typeof context.signal !== "object" || typeof (context.signal as { aborted?: unknown }).aborted !== "boolean" || typeof (context.signal as { addEventListener?: unknown }).addEventListener !== "function") fail("ArtifactExecutionContextV1.signal must be an AbortSignal");
}

export function assertArtifactProfileV1(value: unknown): asserts value is ArtifactProfileV1 {
  const record = assertContractRecord(value, "artifact-profile");
  assertStringArray(record.artifactKinds, "ArtifactProfileV1.artifactKinds");
  if (!Array.isArray(record.fields) || !Array.isArray(record.validators)) fail("ArtifactProfileV1 fields/validators must be arrays");
  const fieldNames = new Set<string>();
  for (const value of record.fields) {
    const field = asObject(value, "ArtifactFieldDefinitionV1");
    assertIdentifier(field.name, "ArtifactFieldDefinitionV1.name");
    if (fieldNames.has(field.name)) fail(`duplicate artifact field '${field.name}'`);
    fieldNames.add(field.name);
    if (!["string", "string_list", "integer", "boolean", "date"].includes(String(field.type))) fail("invalid artifact field type");
    if (typeof field.indexed !== "boolean" || typeof field.filterable !== "boolean") fail("artifact field flags must be boolean");
    if (field.enumValues !== undefined) assertStringArray(field.enumValues, "ArtifactFieldDefinitionV1.enumValues");
  }
  const validatorIds = new Set<string>();
  for (const value of record.validators) {
    const validator = asObject(value, "ArtifactValidatorV1");
    assertIdentifier(validator.id, "ArtifactValidatorV1.id");
    if (validatorIds.has(validator.id)) fail(`duplicate artifact validator '${validator.id}'`);
    validatorIds.add(validator.id);
    if (typeof validator.validate !== "function") fail("ArtifactValidatorV1.validate must be a function");
  }
  if (record.appliesTo !== undefined && typeof record.appliesTo !== "function") fail("ArtifactProfileV1.appliesTo must be a function");
}

export function assertArtifactValidationResultV1(value: unknown): asserts value is ArtifactValidationResultV1 {
  const result = asObject(value, "ArtifactValidationResultV1");
  if (result.outcome === "valid") return;
  if (result.outcome === "unavailable" || result.outcome === "error") {
    assertCode(result.code, "ArtifactValidationResultV1.code");
    if (typeof result.retryable !== "boolean") fail("retryable must be boolean");
    return;
  }
  if ((result.outcome !== "invalid" && result.outcome !== "conflict") || !Array.isArray(result.issues)) fail("invalid validation outcome");
  for (const issueValue of result.issues) {
    const issue = asObject(issueValue, "ArtifactValidationIssueV1");
    assertCode(issue.code, "ArtifactValidationIssueV1.code");
    assertNonEmpty(issue.summary, "ArtifactValidationIssueV1.summary");
  }
}

export function assertArtifactSearchServiceV1(value: unknown): asserts value is ArtifactSearchServiceV1 {
  const record = assertContractRecord(value, "artifact-search-service");
  if (typeof record.search !== "function") fail("ArtifactSearchServiceV1.search must be a function");
}

export function assertTodoLifecycleServiceV1(value: unknown): asserts value is TodoLifecycleServiceV1 {
  const record = assertContractRecord(value, "todo-lifecycle-service");
  if (typeof record.execute !== "function") fail("TodoLifecycleServiceV1.execute must be a function");
}

export function assertArtifactSearchResultV1(value: unknown): asserts value is ArtifactSearchResultV1 {
  const result = asObject(value, "ArtifactSearchResultV1");
  if (typeof result.text !== "string") fail("ArtifactSearchResultV1.text must be a string");
  asObject(result.details, "ArtifactSearchResultV1.details");
  assertArtifactExecutionProvenanceV1(result.provenance);
}

export function assertArtifactExecutionProvenanceV1(value: unknown): asserts value is ArtifactExecutionProvenanceV1 {
  const provenance = asObject(value, "ArtifactExecutionProvenanceV1");
  if (provenance.schema !== "@aefree/pi-project-artifacts/execution-provenance" || provenance.version !== 1) fail("artifact provenance schema/version mismatch");
  const canonical = asObject(provenance.canonical, "ArtifactExecutionProvenanceV1.canonical");
  assertNonEmpty(canonical.serviceId, "canonical.serviceId");
  assertNonEmpty(canonical.packageName, "canonical.packageName");
  assertNonEmpty(canonical.packageVersion, "canonical.packageVersion");
  if (canonical.contractVersion !== 1) fail("canonical.contractVersion must be 1");
  if (!Array.isArray(provenance.profiles) || !Array.isArray(provenance.fallbacks)) fail("artifact provenance arrays are required");
  if (provenance.executionGate !== "executed" && provenance.executionGate !== "blocked") fail("artifact execution gate is invalid");
}

/**
 * Lexically normalizes an absolute POSIX, Windows drive, or Windows UNC path.
 * This deliberately rejects dot-segment traversal. It does not resolve symlinks or junctions.
 */
export function canonicalizeTodoAbsolutePathV1(value: unknown, label = "todo path"): string {
  assertNonEmpty(value, label);
  const input = value.normalize("NFC");
  if (input.includes("\0")) fail(`${label} must not contain NUL`);
  const style = todoPathStyleV1(input, label);
  const rawSegments = input.split(style === "posix" ? "/" : /[\\/]/u);
  if (rawSegments.some((segment) => segment === "." || segment === "..")) fail(`${label} must not contain traversal segments`);
  if (style === "posix") {
    if (input.includes("\\")) fail(`${label} must not mix POSIX and Windows separators`);
    return trimTodoPathTrailingSeparator(posixPath.normalize(input), style);
  }
  if (style === "windows-unc" && /^[\\/]{2}[?.][\\/]/u.test(input)) fail(`${label} must not use a Windows device namespace`);
  const windowsInput = input.replaceAll("/", "\\");
  const pathSegments = windowsInput.split("\\").filter(Boolean);
  const segmentsAfterRoot = style === "windows-drive" ? pathSegments.slice(1) : pathSegments.slice(2);
  if (segmentsAfterRoot.some((segment) => segment.includes(":") || /[. ]$/u.test(segment))) {
    fail(`${label} contains a non-canonical Windows path segment`);
  }
  let normalized = win32Path.normalize(windowsInput);
  if (style === "windows-drive") normalized = `${normalized[0]!.toUpperCase()}${normalized.slice(1)}`;
  return trimTodoPathTrailingSeparator(normalized, style);
}

/** Resolves the explicit todos root or the canonical `<workspaceRoot>/todos` default. */
export function resolveTodoPathContextV1(workspaceRoot: unknown, todosRoot?: unknown): Readonly<TodoPathContextV1> {
  const canonicalWorkspaceRoot = canonicalizeTodoAbsolutePathV1(workspaceRoot, "TodoPathContextV1.workspaceRoot");
  const style = todoPathStyleV1(canonicalWorkspaceRoot, "TodoPathContextV1.workspaceRoot");
  const implementation = style === "posix" ? posixPath : win32Path;
  const canonicalTodosRoot = todosRoot === undefined
    ? canonicalizeTodoAbsolutePathV1(implementation.join(canonicalWorkspaceRoot, "todos"), "TodoPathContextV1.todosRoot")
    : canonicalizeTodoAbsolutePathV1(todosRoot, "TodoPathContextV1.todosRoot");
  if (todoPathStyleV1(canonicalTodosRoot, "TodoPathContextV1.todosRoot") !== style) {
    fail("TodoPathContextV1 workspaceRoot and todosRoot must use the same path style");
  }
  return Object.freeze({ workspaceRoot: canonicalWorkspaceRoot, todosRoot: canonicalTodosRoot, style });
}

/** Returns a normalization- and case-folded identity suitable for conservative collision checks. */
export function todoPathCollisionKeyV1(value: unknown): string {
  const canonical = canonicalizeTodoAbsolutePathV1(value);
  const style = todoPathStyleV1(canonical, "todo path");
  return `${style}:${canonical.replaceAll("\\", "/").normalize("NFKC").toLowerCase()}`;
}

/** Asserts lexical containment under a resolved todos root and returns the normalized path. */
export function assertTodoPathContainedV1(value: unknown, context: TodoPathContextV1, label = "todo path"): string {
  const validatedContext = assertTodoPathContextV1(context);
  const candidate = canonicalizeTodoAbsolutePathV1(value, label);
  const candidateStyle = todoPathStyleV1(candidate, label);
  if (candidateStyle !== validatedContext.style) fail(`${label} must use the todosRoot path style`);
  const separator = validatedContext.style === "posix" ? "/" : "\\";
  const root = validatedContext.style === "posix" ? validatedContext.todosRoot : validatedContext.todosRoot.toLowerCase();
  const compared = validatedContext.style === "posix" ? candidate : candidate.toLowerCase();
  const prefix = root.endsWith(separator) ? root : `${root}${separator}`;
  if (!compared.startsWith(prefix)) fail(`${label} must be contained under todosRoot`);
  return candidate;
}

/** Parses and validates `{renderedId}-{status}-{priority}-{description}.md`. */
export function parseCanonicalTodoBasenameV1(value: unknown): Readonly<ParsedTodoBasenameV1> {
  assertNonEmpty(value, "todo basename");
  if (value.includes("/") || value.includes("\\")) fail("todo basename must not contain path separators");
  const match = /^(\d{3,})-(pending|ready|complete)-(p1|p2|p3)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/u.exec(value);
  if (match === null) fail("todo basename must use the canonical id-status-priority-description.md form");
  const renderedId = match[1]!;
  const issueId = Number(renderedId);
  assertPositiveSafeInteger(issueId, "todo basename issueId");
  assertRenderedTodoIdV1(renderedId, issueId, "todo basename renderedId");
  return Object.freeze({
    basename: value,
    issueId,
    renderedId,
    status: match[2] as TodoStatusV1,
    priority: match[3] as TodoPriorityV1,
    description: match[4]!,
  });
}

/** Parses a canonical todo filename without consulting the filesystem. */
export function parseCanonicalTodoPathV1(value: unknown): Readonly<ParsedTodoPathV1> {
  const canonical = canonicalizeTodoAbsolutePathV1(value);
  const style = todoPathStyleV1(canonical, "todo path");
  const implementation = style === "posix" ? posixPath : win32Path;
  const parsed = parseCanonicalTodoBasenameV1(implementation.basename(canonical));
  return Object.freeze({ ...parsed, path: canonical, directory: implementation.dirname(canonical), style });
}

export function assertTodoLifecycleRequestV1(value: unknown): asserts value is TodoLifecycleRequestV1 {
  const request = asObject(value, "TodoLifecycleRequestV1");
  const context = resolveTodoPathContextV1(request.workspaceRoot, hasOwn(request, "todosRoot") ? request.todosRoot : undefined);

  switch (request.operation) {
    case "inspect":
      assertOnlyKeys(request, ["operation", "workspaceRoot", "todosRoot", "path"], "TodoLifecycleRequestV1.inspect");
      assertTodoPathContainedV1(request.path, context, "TodoLifecycleRequestV1.inspect.path");
      parseCanonicalTodoPathV1(request.path);
      return;
    case "list":
      assertOnlyKeys(request, ["operation", "workspaceRoot", "todosRoot"], "TodoLifecycleRequestV1.list");
      return;
    case "allocate_id":
      assertOnlyKeys(request, ["operation", "workspaceRoot", "todosRoot", "expectedDirectoryHash"], "TodoLifecycleRequestV1.allocate_id");
      if (hasOwn(request, "expectedDirectoryHash")) assertSha256(request.expectedDirectoryHash, "TodoLifecycleRequestV1.allocate_id.expectedDirectoryHash");
      return;
    case "create": {
      assertOnlyKeys(request, ["operation", "workspaceRoot", "todosRoot", "todo", "expectedDirectoryHash", "exclusive"], "TodoLifecycleRequestV1.create");
      if (request.exclusive !== true) fail("todo creation must be exclusive");
      if (hasOwn(request, "expectedDirectoryHash")) assertSha256(request.expectedDirectoryHash, "TodoLifecycleRequestV1.create.expectedDirectoryHash");
      const todo = asObject(request.todo, "TodoDocumentInputV1");
      assertOnlyKeys(todo, ["title", "priority", "status", "body", "frontmatter"], "TodoDocumentInputV1");
      assertNonEmpty(todo.title, "TodoDocumentInputV1.title");
      assertTodoPriorityV1(todo.priority, "TodoDocumentInputV1.priority");
      let status: TodoStatusV1 = "pending";
      if (hasOwn(todo, "status")) {
        assertTodoStatusV1(todo.status, "TodoDocumentInputV1.status");
        status = todo.status;
      }
      if (typeof todo.body !== "string") fail("TodoDocumentInputV1.body must be a string");
      if (hasOwn(todo, "frontmatter")) assertTodoFrontmatterV1(todo.frontmatter, status, todo.priority);
      return;
    }
    case "transition": {
      assertOnlyKeys(request, ["operation", "workspaceRoot", "todosRoot", "path", "toStatus", "expectedContentHash"], "TodoLifecycleRequestV1.transition");
      assertTodoPathContainedV1(request.path, context, "TodoLifecycleRequestV1.transition.path");
      const current = parseCanonicalTodoPathV1(request.path);
      assertTodoStatusV1(request.toStatus, "TodoLifecycleRequestV1.transition.toStatus");
      if (request.toStatus === current.status) fail("TodoLifecycleRequestV1.transition.toStatus must change status");
      assertSha256(request.expectedContentHash, "TodoLifecycleRequestV1.transition.expectedContentHash");
      return;
    }
    default:
      fail("unknown todo operation");
  }
}

export function assertTodoLifecycleResultV1(value: unknown): asserts value is TodoLifecycleResultV1 {
  const result = asObject(value, "TodoLifecycleResultV1");
  switch (result.outcome) {
    case "inspected":
      assertOnlyKeys(result, ["outcome", "state", "todo", "issues"], "TodoLifecycleResultV1.inspected");
      if (result.state !== "valid" && result.state !== "invalid" && result.state !== "conflict") fail("TodoLifecycleResultV1.inspected.state is invalid");
      if (hasOwn(result, "todo")) assertTodoIdentityV1(result.todo);
      assertTodoIssuesV1(result.issues, "TodoLifecycleResultV1.inspected.issues", false);
      if (result.state === "valid" && !hasOwn(result, "todo")) fail("a valid inspected result requires todo identity");
      if (result.state === "valid" && (result.issues as unknown[]).length !== 0) fail("a valid inspected result must not contain issues");
      if (result.state !== "valid" && (result.issues as unknown[]).length === 0) fail("an invalid/conflict inspected result requires issues");
      return;
    case "listed": {
      assertOnlyKeys(result, ["outcome", "todos", "issues"], "TodoLifecycleResultV1.listed");
      if (!Array.isArray(result.todos)) fail("TodoLifecycleResultV1.listed.todos must be an array");
      const issueIds = new Set<number>();
      const paths = new Set<string>();
      for (const todo of result.todos) {
        assertTodoIdentityV1(todo);
        const identity = todo as TodoIdentityV1;
        const pathKey = todoPathCollisionKeyV1(identity.path);
        if (paths.has(pathKey)) fail("TodoLifecycleResultV1.listed contains a normalized/case-fold path collision");
        paths.add(pathKey);
        if (issueIds.has(identity.issueId)) fail(`TodoLifecycleResultV1.listed contains duplicate issueId ${identity.issueId}`);
        issueIds.add(identity.issueId);
      }
      assertTodoIssuesV1(result.issues, "TodoLifecycleResultV1.listed.issues", true);
      return;
    }
    case "allocated":
      assertOnlyKeys(result, ["outcome", "issueId", "renderedId", "directoryHash"], "TodoLifecycleResultV1.allocated");
      assertPositiveSafeInteger(result.issueId, "TodoLifecycleResultV1.allocated.issueId");
      assertRenderedTodoIdV1(result.renderedId, result.issueId as number, "TodoLifecycleResultV1.allocated.renderedId");
      assertSha256(result.directoryHash, "TodoLifecycleResultV1.allocated.directoryHash");
      return;
    case "created":
      assertOnlyKeys(result, ["outcome", "todo"], "TodoLifecycleResultV1.created");
      assertTodoIdentityV1(result.todo);
      return;
    case "transitioned":
      assertOnlyKeys(result, ["outcome", "todo", "previousPath"], "TodoLifecycleResultV1.transitioned");
      assertTodoIdentityV1(result.todo);
      assertNonEmpty(result.previousPath, "TodoLifecycleResultV1.transitioned.previousPath");
      parseCanonicalTodoPathV1(result.previousPath);
      return;
    case "conflict":
    case "blocked":
      assertOnlyKeys(result, ["outcome", "code", "summary", "currentContentHash"], `TodoLifecycleResultV1.${result.outcome}`);
      assertCode(result.code, `TodoLifecycleResultV1.${result.outcome}.code`);
      assertNonEmpty(result.summary, `TodoLifecycleResultV1.${result.outcome}.summary`);
      if (hasOwn(result, "currentContentHash")) assertSha256(result.currentContentHash, `TodoLifecycleResultV1.${result.outcome}.currentContentHash`);
      return;
    default:
      fail("unknown todo result outcome");
  }
}

/** Validates result paths and operation semantics in the request's root context. */
export function assertTodoLifecycleResultForRequestV1(value: unknown, requestValue: unknown): asserts value is TodoLifecycleResultV1 {
  assertTodoLifecycleRequestV1(requestValue);
  assertTodoLifecycleResultV1(value);
  const request = requestValue as TodoLifecycleRequestV1;
  const result = value as TodoLifecycleResultV1;
  const context = resolveTodoPathContextV1(request.workspaceRoot, request.todosRoot);

  if (result.outcome === "conflict" || result.outcome === "blocked") return;
  const expectedOutcome = ({
    inspect: "inspected",
    list: "listed",
    allocate_id: "allocated",
    create: "created",
    transition: "transitioned",
  } as const)[request.operation];
  if (result.outcome !== expectedOutcome) fail(`todo ${request.operation} cannot return ${result.outcome}`);

  switch (request.operation) {
    case "inspect": {
      const inspected = result as Extract<TodoLifecycleResultV1, { outcome: "inspected" }>;
      if (inspected.todo !== undefined) {
        assertTodoIdentityInContextV1(inspected.todo, context, "TodoLifecycleResultV1.inspected.todo");
        if (!todoPathsEquivalentV1(inspected.todo.path, request.path, context.style)) fail("inspected todo path must match the requested path");
      }
      return;
    }
    case "list": {
      const listed = result as Extract<TodoLifecycleResultV1, { outcome: "listed" }>;
      for (const todo of listed.todos) assertTodoIdentityInContextV1(todo, context, "TodoLifecycleResultV1.listed.todo");
      for (const issue of listed.issues) {
        if (issue.path !== undefined) assertTodoPathContainedV1(issue.path, context, "TodoLifecycleResultV1.listed.issue.path");
      }
      return;
    }
    case "allocate_id":
      return;
    case "create": {
      const created = result as Extract<TodoLifecycleResultV1, { outcome: "created" }>;
      assertTodoIdentityInContextV1(created.todo, context, "TodoLifecycleResultV1.created.todo");
      const expectedStatus = request.todo.status ?? "pending";
      if (created.todo.status !== expectedStatus) fail("created todo status must match the create request");
      if (created.todo.priority !== request.todo.priority) fail("created todo priority must match the create request");
      return;
    }
    case "transition": {
      const transitioned = result as Extract<TodoLifecycleResultV1, { outcome: "transitioned" }>;
      assertTodoIdentityInContextV1(transitioned.todo, context, "TodoLifecycleResultV1.transitioned.todo");
      assertTodoPathContainedV1(transitioned.previousPath, context, "TodoLifecycleResultV1.transitioned.previousPath");
      if (!todoPathsEquivalentV1(transitioned.previousPath, request.path, context.style)) fail("transition previousPath must match the requested path");
      const previous = parseCanonicalTodoPathV1(request.path);
      const next = parseCanonicalTodoPathV1(transitioned.todo.path);
      if (transitioned.todo.status !== request.toStatus || next.status !== request.toStatus) fail("transitioned todo status must match toStatus");
      if (next.issueId !== previous.issueId || next.renderedId !== previous.renderedId || next.priority !== previous.priority || next.description !== previous.description) {
        fail("transitioned todo path may only change the status segment");
      }
      const implementation = context.style === "posix" ? posixPath : win32Path;
      if (!todoPathsEquivalentV1(next.directory, previous.directory, context.style)
        || transitioned.todo.issueId !== previous.issueId
        || transitioned.todo.renderedId !== previous.renderedId
        || transitioned.todo.priority !== previous.priority) {
        fail("transitioned todo identity must preserve the prior path identity");
      }
      const expectedPath = implementation.join(previous.directory, `${previous.renderedId}-${request.toStatus}-${previous.priority}-${previous.description}.md`);
      if (!todoPathsEquivalentV1(transitioned.todo.path, expectedPath, context.style)) fail("transitioned todo path does not match canonical rename semantics");
      return;
    }
  }
}

function assertTodoIdentityV1(value: unknown): asserts value is TodoIdentityV1 {
  const todo = asObject(value, "TodoIdentityV1");
  assertOnlyKeys(todo, ["issueId", "renderedId", "status", "priority", "path", "contentHash"], "TodoIdentityV1");
  assertPositiveSafeInteger(todo.issueId, "TodoIdentityV1.issueId");
  assertRenderedTodoIdV1(todo.renderedId, todo.issueId as number, "TodoIdentityV1.renderedId");
  assertTodoStatusV1(todo.status, "TodoIdentityV1.status");
  assertTodoPriorityV1(todo.priority, "TodoIdentityV1.priority");
  const parsed = parseCanonicalTodoPathV1(todo.path);
  if (parsed.issueId !== todo.issueId || parsed.renderedId !== todo.renderedId || parsed.status !== todo.status || parsed.priority !== todo.priority) {
    fail("TodoIdentityV1 fields must match its canonical filename");
  }
  assertSha256(todo.contentHash, "TodoIdentityV1.contentHash");
}

function assertTodoIdentityInContextV1(todo: TodoIdentityV1, context: TodoPathContextV1, label: string): void {
  assertTodoPathContainedV1(todo.path, context, `${label}.path`);
}

function todoPathsEquivalentV1(left: unknown, right: unknown, style: TodoPathStyleV1): boolean {
  const canonicalLeft = canonicalizeTodoAbsolutePathV1(left);
  const canonicalRight = canonicalizeTodoAbsolutePathV1(right);
  if (todoPathStyleV1(canonicalLeft, "left path") !== style || todoPathStyleV1(canonicalRight, "right path") !== style) return false;
  return style === "posix" ? canonicalLeft === canonicalRight : canonicalLeft.toLowerCase() === canonicalRight.toLowerCase();
}

function assertTodoFrontmatterV1(value: unknown, status: TodoStatusV1, priority: TodoPriorityV1): void {
  const frontmatter = value as unknown;
  assertPlainRecord(frontmatter, "TodoDocumentInputV1.frontmatter");
  const metadata = frontmatter as Readonly<Record<string, unknown>>;
  const metadataKeys = assertEnumerableDataKeysV1(metadata, "TodoDocumentInputV1.frontmatter");
  const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  const normalizedEntries = metadataKeys
    .map((key) => ({ key, normalized: normalizeTodoFrontmatterKeyV1(key) }))
    .sort((left, right) => compare(left.normalized, right.normalized) || compare(left.key, right.key));
  for (let index = 0; index < normalizedEntries.length; index += 1) {
    const entry = normalizedEntries[index]!;
    if (entry.normalized === "") fail(`TodoDocumentInputV1.frontmatter key '${entry.key}' is invalid`);
    if (index > 0 && normalizedEntries[index - 1]!.normalized === entry.normalized) {
      fail(`TodoDocumentInputV1.frontmatter contains equivalent keys '${normalizedEntries[index - 1]!.key}' and '${entry.key}'`);
    }
    if (entry.key !== entry.normalized && (TODO_CANONICAL_FRONTMATTER_KEYS_V1 as readonly string[]).includes(entry.normalized)) {
      fail(`TodoDocumentInputV1.frontmatter key '${entry.key}' conflicts with reserved '${entry.normalized}'`);
    }
    if ((TODO_FORBIDDEN_FRONTMATTER_KEYS_V1 as readonly string[]).includes(entry.normalized)) {
      fail(`TodoDocumentInputV1.frontmatter key '${entry.key}' is reserved`);
    }
    if (entry.normalized === "status" && metadata[entry.key] !== status) fail("frontmatter status must exactly match the top-level status");
    if (entry.normalized === "priority" && metadata[entry.key] !== priority) fail("frontmatter priority must exactly match the top-level priority");
  }
  assertTodoMetadataValueV1(metadata, "TodoDocumentInputV1.frontmatter", new Set<object>());
}

function normalizeTodoFrontmatterKeyV1(value: string): string {
  return value.normalize("NFKC")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function assertTodoMetadataValueV1(value: unknown, label: string, ancestors: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} numbers must be finite`);
    return;
  }
  if (typeof value !== "object") fail(`${label} contains a non-data value`);
  if (ancestors.has(value)) fail(`${label} must not contain cycles`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertTodoMetadataValueV1(value[index], `${label}[${index}]`, ancestors);
  } else {
    assertPlainRecord(value, label);
    for (const key of assertEnumerableDataKeysV1(value as Record<string, unknown>, label)) {
      assertTodoMetadataValueV1((value as Record<string, unknown>)[key], `${label}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function assertEnumerableDataKeysV1(value: object, label: string): string[] {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`${label} must not contain symbol keys`);
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) fail(`${label}.${key} must be an enumerable data property`);
    keys.push(key);
  }
  return keys;
}

function assertTodoIssuesV1(value: unknown, label: string, allowPath: boolean): void {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  for (const entry of value) {
    const issue = asObject(entry, `${label} item`);
    assertOnlyKeys(issue, allowPath ? ["path", "code", "summary"] : ["code", "summary"], `${label} item`);
    assertCode(issue.code, `${label}.code`);
    assertNonEmpty(issue.summary, `${label}.summary`);
    if (hasOwn(issue, "path")) assertAbsolutePath(issue.path, `${label}.path`);
  }
}

function assertTodoPathContextV1(value: unknown): TodoPathContextV1 {
  const context = asObject(value, "TodoPathContextV1");
  assertOnlyKeys(context, ["workspaceRoot", "todosRoot", "style"], "TodoPathContextV1");
  const workspaceRoot = canonicalizeTodoAbsolutePathV1(context.workspaceRoot, "TodoPathContextV1.workspaceRoot");
  const todosRoot = canonicalizeTodoAbsolutePathV1(context.todosRoot, "TodoPathContextV1.todosRoot");
  if (workspaceRoot !== context.workspaceRoot || todosRoot !== context.todosRoot) fail("TodoPathContextV1 roots must be canonical");
  const style = todoPathStyleV1(workspaceRoot, "TodoPathContextV1.workspaceRoot");
  if (style !== todoPathStyleV1(todosRoot, "TodoPathContextV1.todosRoot") || context.style !== style) fail("TodoPathContextV1 path styles must match");
  return context as unknown as TodoPathContextV1;
}

function todoPathStyleV1(value: string, label: string): TodoPathStyleV1 {
  if (/^[A-Za-z]:[\\/]/u.test(value)) return "windows-drive";
  if (/^[\\/]{2}[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/u.test(value)) return "windows-unc";
  if (value.startsWith("/") && !value.startsWith("//")) return "posix";
  fail(`${label} must be an absolute POSIX, Windows drive, or Windows UNC path`);
}

function trimTodoPathTrailingSeparator(value: string, style: TodoPathStyleV1): string {
  const implementation = style === "posix" ? posixPath : win32Path;
  const root = implementation.parse(value).root;
  let normalized = value;
  while (normalized.length > root.length && (normalized.endsWith("/") || normalized.endsWith("\\"))) normalized = normalized.slice(0, -1);
  return normalized;
}

function assertPositiveSafeInteger(value: unknown, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
}

function assertRenderedTodoIdV1(value: unknown, issueId: number, label: string): void {
  if (typeof value !== "string" || !/^\d{3,}$/.test(value)) fail(`${label} must contain at least three decimal digits`);
  if (value !== String(issueId).padStart(3, "0")) fail(`${label} must match issueId`);
}

function assertTodoStatusV1(value: unknown, label: string): asserts value is TodoStatusV1 {
  if (value !== "pending" && value !== "ready" && value !== "complete") fail(`${label} is invalid`);
}

function assertTodoPriorityV1(value: unknown, label: string): asserts value is TodoPriorityV1 {
  if (value !== "p1" && value !== "p2" && value !== "p3") fail(`${label} is invalid`);
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) fail(`${label} must be a sha256 digest`);
}

function assertAbsolutePath(value: unknown, label: string): asserts value is string {
  assertNonEmpty(value, label);
  if (value.includes("\0") || !(value.startsWith("/") || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/.test(value) || /^[A-Za-z]:[/\\]/.test(value))) {
    fail(`${label} must be an absolute path`);
  }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertPlainRecord(value: unknown, label: string): asserts value is Readonly<Record<string, unknown>> {
  const record = asObject(value, label);
  const prototype = Object.getPrototypeOf(record) as unknown;
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a record object`);
}

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is not allowed`);
}

function resolveContracts<TRecord extends RegistryRecord>(scope: object, registry: CapabilityRegistry<TRecord>, exclusive: boolean): ContractResolutionV1<TRecord> {
  const catalog = registry.catalog(scope);
  const records = registry.snapshotCompatible(scope);
  const ids = records.map((record) => record.id).sort();
  const duplicate = ids.some((id, index) => index > 0 && id === ids[index - 1]) || (exclusive && records.length > 1);
  if (duplicate) return Object.freeze({ outcome: "duplicate" as const, code: "duplicate_registration" as const, expectedContractVersion: 1 as const, registryKey: registry.registryKey, providerIds: Object.freeze([...new Set(ids)]), catalog });
  if (records.length > 0) return Object.freeze({ outcome: "available" as const, records, catalog });
  const incompatible = catalog.status === "incompatible";
  return Object.freeze({ outcome: incompatible ? "incompatible" as const : "missing" as const, code: incompatible ? "incompatible_contract" as const : "missing_registration" as const, expectedContractVersion: 1 as const, registryKey: registry.registryKey, providerIds: Object.freeze(incompatibleCatalogIds(catalog)), catalog });
}

function incompatibleCatalogIds(catalog: VersionCatalog): string[] {
  return [...new Set(catalog.versions
    .filter((entry) => !entry.compatible)
    .flatMap((entry) => entry.registrations.map((registration) => registration.id)))]
    .sort();
}

function assertContractRecord(value: unknown, kind: string): Record<string, unknown> {
  const record = asObject(value, kind);
  if (record.contractVersion !== 1 || record.kind !== kind) fail(`${kind} contractVersion/kind mismatch`);
  assertNonEmpty(record.id, `${kind}.id`);
  const owner = asObject(record.owner, `${kind}.owner`);
  assertNonEmpty(owner.packageName, "owner.packageName");
  assertNonEmpty(owner.packageRoot, "owner.packageRoot");
  assertNonEmpty(owner.packageVersion, "owner.packageVersion");
  assertNonEmpty(owner.registeredBy, "owner.registeredBy");
  return record;
}

function assertCode(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]*$/.test(value)) fail(`${label} is invalid`);
}
function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]*$/.test(value)) fail(`${label} is invalid`);
}
function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
}
function assertStringArray(value: unknown, label: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) fail(`${label} must be a string array`);
}
function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function fail(message: string): never { throw new TypeError(message); }
