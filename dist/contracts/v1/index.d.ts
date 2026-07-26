import { type CapabilityRegistry, type RegistryOwner, type RegistryRecord, type VersionCatalog } from "@aefree/pi-capability-registry";
export declare const PROJECT_ARTIFACTS_CONTRACT_VERSION_V1: 1;
export declare const ARTIFACT_PROFILE_REGISTRY_KEY_V1: "@aefree/pi-project-artifacts/profiles/v1";
export declare const ARTIFACT_SEARCH_SERVICE_REGISTRY_KEY_V1: "@aefree/pi-project-artifacts/search-services/v1";
export declare const TODO_LIFECYCLE_SERVICE_REGISTRY_KEY_V1: "@aefree/pi-project-artifacts/todo-lifecycle-services/v1";
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
export interface CompatibilityInvocationV1 {
    readonly contractVersion: 1;
    readonly surface: string;
    readonly ownerPackage: string;
    readonly ownerVersion?: string;
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
    readonly compatibility?: CompatibilityInvocationV1;
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
export type CompatibilityExecutionProvenanceV1 = ArtifactExecutionProvenanceV1;
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
    readonly kind: "doc" | "solution" | "plan" | "todo" | "other";
    readonly frontmatter: Readonly<Record<string, unknown>>;
    readonly body?: string;
}
export interface ArtifactValidationRequestV1 {
    readonly operation: "index" | "search" | "create" | "update";
    readonly workspaceRoot: string;
    readonly artifact: ArtifactCandidateV1;
    readonly signal: AbortSignal;
}
export type ArtifactValidationResultV1 = {
    readonly outcome: "valid";
} | {
    readonly outcome: "invalid" | "conflict";
    readonly issues: readonly {
        readonly code: string;
        readonly field?: string;
        readonly summary: string;
    }[];
} | {
    readonly outcome: "unavailable" | "error";
    readonly code: string;
    readonly retryable: boolean;
};
export interface ArtifactValidatorV1 {
    readonly id: string;
    validate(context: ArtifactExecutionContextV1, request: ArtifactValidationRequestV1): Promise<ArtifactValidationResultV1>;
}
export interface ArtifactProfileV1 extends RegistryRecord {
    readonly contractVersion: 1;
    readonly kind: "artifact-profile";
    readonly owner: ArtifactOwnerV1;
    readonly artifactKinds: readonly string[];
    readonly fields: readonly ArtifactFieldDefinitionV1[];
    readonly validators: readonly ArtifactValidatorV1[];
    /** Optional target-scoped applicability test; receives current execution context. */
    appliesTo?(context: ArtifactExecutionContextV1, request: {
        readonly workspaceRoot: string;
        readonly artifactPath?: string;
        readonly signal: AbortSignal;
    }): Promise<boolean>;
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
    readonly compatibility?: CompatibilityInvocationV1;
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
    search(context: ArtifactExecutionContextV1, request: ArtifactSearchRequestV1): Promise<ArtifactSearchResultV1>;
}
export type TodoStatusV1 = "pending" | "ready" | "complete";
export type TodoPriorityV1 = "p1" | "p2" | "p3";
export type TodoPathStyleV1 = "posix" | "windows-drive" | "windows-unc";
/** Frontmatter fields owned by the canonical todo writer rather than caller metadata. */
export declare const TODO_CANONICAL_FRONTMATTER_KEYS_V1: readonly ["issue_id", "status", "priority"];
/** Contract/runtime identity fields that caller-supplied frontmatter may never shadow. */
export declare const TODO_FORBIDDEN_FRONTMATTER_KEYS_V1: readonly ["id", "identity", "identity_id", "issue_id", "rendered_id", "title", "path", "previous_path", "file_path", "source_path", "target_path", "filename", "basename", "hash", "sha256", "identity_hash", "content_hash", "directory_hash", "expected_content_hash", "expected_directory_hash", "workspace_root", "todos_root"];
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
export type TodoLifecycleRequestV1 = {
    readonly operation: "inspect";
    readonly workspaceRoot: string;
    readonly todosRoot?: string;
    readonly path: string;
} | {
    readonly operation: "list";
    readonly workspaceRoot: string;
    readonly todosRoot?: string;
} | {
    readonly operation: "allocate_id";
    readonly workspaceRoot: string;
    readonly todosRoot?: string;
    readonly expectedDirectoryHash?: string;
} | {
    readonly operation: "create";
    readonly workspaceRoot: string;
    readonly todosRoot?: string;
    readonly todo: TodoDocumentInputV1;
    readonly expectedDirectoryHash?: string;
    readonly exclusive: true;
} | {
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
export type TodoLifecycleResultV1 = {
    readonly outcome: "inspected";
    readonly state: "valid" | "invalid" | "conflict";
    readonly todo?: TodoIdentityV1;
    readonly issues: readonly {
        readonly code: string;
        readonly summary: string;
    }[];
} | {
    readonly outcome: "listed";
    readonly todos: readonly TodoIdentityV1[];
    readonly issues: readonly {
        readonly path?: string;
        readonly code: string;
        readonly summary: string;
    }[];
} | {
    readonly outcome: "allocated";
    readonly issueId: number;
    readonly renderedId: string;
    readonly directoryHash: string;
} | {
    readonly outcome: "created";
    readonly todo: TodoIdentityV1;
} | {
    readonly outcome: "transitioned";
    readonly todo: TodoIdentityV1;
    readonly previousPath: string;
} | {
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
    execute(context: ArtifactExecutionContextV1, request: TodoLifecycleRequestV1): Promise<TodoLifecycleResultV1>;
}
export type ContractResolutionV1<TRecord extends RegistryRecord> = {
    readonly outcome: "available";
    readonly records: readonly Readonly<TRecord>[];
    readonly catalog: VersionCatalog;
} | {
    readonly outcome: "missing" | "incompatible" | "duplicate";
    readonly code: "missing_registration" | "incompatible_contract" | "duplicate_registration";
    readonly expectedContractVersion: 1;
    readonly registryKey: string;
    readonly providerIds: readonly string[];
    readonly catalog: VersionCatalog;
};
export declare function createArtifactProfileRegistryV1(): CapabilityRegistry<ArtifactProfileV1>;
export declare function createArtifactSearchServiceRegistryV1(): CapabilityRegistry<ArtifactSearchServiceV1>;
export declare function createTodoLifecycleServiceRegistryV1(): CapabilityRegistry<TodoLifecycleServiceV1>;
export declare function resolveArtifactProfilesV1(scope: object, registry?: CapabilityRegistry<ArtifactProfileV1>): ContractResolutionV1<ArtifactProfileV1>;
export declare function resolveArtifactSearchServiceV1(scope: object, registry?: CapabilityRegistry<ArtifactSearchServiceV1>): ContractResolutionV1<ArtifactSearchServiceV1>;
export declare function resolveTodoLifecycleServiceV1(scope: object, registry?: CapabilityRegistry<TodoLifecycleServiceV1>): ContractResolutionV1<TodoLifecycleServiceV1>;
export declare function assertArtifactExecutionContextV1(value: unknown): asserts value is ArtifactExecutionContextV1;
export declare function assertArtifactProfileV1(value: unknown): asserts value is ArtifactProfileV1;
export declare function assertArtifactValidationResultV1(value: unknown): asserts value is ArtifactValidationResultV1;
export declare function assertArtifactSearchServiceV1(value: unknown): asserts value is ArtifactSearchServiceV1;
export declare function assertTodoLifecycleServiceV1(value: unknown): asserts value is TodoLifecycleServiceV1;
export declare function assertArtifactSearchResultV1(value: unknown): asserts value is ArtifactSearchResultV1;
export declare function assertArtifactExecutionProvenanceV1(value: unknown): asserts value is ArtifactExecutionProvenanceV1;
/**
 * Lexically normalizes an absolute POSIX, Windows drive, or Windows UNC path.
 * This deliberately rejects dot-segment traversal. It does not resolve symlinks or junctions.
 */
export declare function canonicalizeTodoAbsolutePathV1(value: unknown, label?: string): string;
/** Resolves the explicit todos root or the canonical `<workspaceRoot>/todos` default. */
export declare function resolveTodoPathContextV1(workspaceRoot: unknown, todosRoot?: unknown): Readonly<TodoPathContextV1>;
/** Returns a normalization- and case-folded identity suitable for conservative collision checks. */
export declare function todoPathCollisionKeyV1(value: unknown): string;
/** Asserts lexical containment under a resolved todos root and returns the normalized path. */
export declare function assertTodoPathContainedV1(value: unknown, context: TodoPathContextV1, label?: string): string;
/** Parses and validates `{renderedId}-{status}-{priority}-{description}.md`. */
export declare function parseCanonicalTodoBasenameV1(value: unknown): Readonly<ParsedTodoBasenameV1>;
/** Parses a canonical todo filename without consulting the filesystem. */
export declare function parseCanonicalTodoPathV1(value: unknown): Readonly<ParsedTodoPathV1>;
export declare function assertTodoLifecycleRequestV1(value: unknown): asserts value is TodoLifecycleRequestV1;
export declare function assertTodoLifecycleResultV1(value: unknown): asserts value is TodoLifecycleResultV1;
/** Validates result paths and operation semantics in the request's root context. */
export declare function assertTodoLifecycleResultForRequestV1(value: unknown, requestValue: unknown): asserts value is TodoLifecycleResultV1;
//# sourceMappingURL=index.d.ts.map