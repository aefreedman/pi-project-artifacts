import { type ArtifactExecutionContextV1, type ArtifactProfileV1, type ArtifactValidationResultV1 } from "../contracts/v1/index.js";
import { type FailureInjector } from "./atomic.js";
import { type ArtifactRoots } from "./roots.js";
export declare const ARTIFACT_INDEX_SCHEMA: "@aefree/pi-project-artifacts/index";
export declare const ARTIFACT_INDEX_VERSION: 1;
export type ArtifactKind = "doc" | "solution" | "plan" | "memory" | "todo" | "other-doc";
export type SearchField = "path" | "title" | "tags" | "frontmatter" | "headings" | "body";
export type FreshnessMode = "auto" | "strict" | "memory";
export type ProfileEntryData = Readonly<{
    profileId: string;
    packageName: string;
    packageVersion: string;
    contractVersion: 1;
    validation: ArtifactValidationResultV1;
}>;
export type ArtifactIndexEntryV1 = Readonly<{
    path: string;
    root: "docs" | "todos";
    kind: ArtifactKind;
    mtimeMs: number;
    size: number;
    contentHash: string;
    title?: string;
    frontmatter: Readonly<Record<string, unknown>>;
    frontmatterMalformed: boolean;
    headings: readonly string[];
    bodyPreview: string;
    linksTo: readonly string[];
    profileData: readonly ProfileEntryData[];
}>;
export type ArtifactIndexV1 = Readonly<{
    schema: typeof ARTIFACT_INDEX_SCHEMA;
    version: typeof ARTIFACT_INDEX_VERSION;
    generatedAt: string;
    workspaceRoot: string;
    docsRoot: string;
    todosRoot: string;
    rootIdentity: string;
    profiles: readonly {
        profileId: string;
        packageName: string;
        packageVersion: string;
        contractVersion: 1;
    }[];
    files: Readonly<Record<string, ArtifactIndexEntryV1>>;
}>;
export type RefreshStats = Readonly<{
    added: number;
    updated: number;
    removed: number;
    unchanged: number;
}>;
export type RefreshResult = Readonly<{
    index: ArtifactIndexV1;
    indexPath: string;
    refreshed: boolean;
    fastPath: boolean;
    freshnessMode: FreshnessMode;
    stats: RefreshStats;
    orphanTempsRemoved: readonly string[];
}>;
export type ArtifactCacheState = "auto_fast_path" | "memory_fast_path" | "validated_unchanged" | "rebuilt";
export declare function artifactCacheState(refresh: Pick<RefreshResult, "fastPath" | "freshnessMode" | "refreshed">): ArtifactCacheState;
export type IndexRequest = Readonly<{
    workspaceRoot?: string;
    docsRoot?: string;
    todosRoot?: string;
    indexPath?: string;
    freshnessMode?: FreshnessMode;
    freshnessTtlMs?: number;
    rebuild?: boolean;
}>;
export type ObservedFieldCatalogEntry = Readonly<{
    name: string;
    documentCount: number;
    inferredPrimitiveTypes: readonly ("string" | "number" | "boolean" | "null")[];
    distinctCount: number;
    distinctCountCapped: boolean;
    sampleValues: readonly string[];
}>;
export type ObservedFieldCatalog = Readonly<{
    fields: readonly ObservedFieldCatalogEntry[];
    totalFieldCount: number;
    truncated: boolean;
}>;
export declare function defaultIndexFilename(roots: ArtifactRoots): string;
export declare function resolveIndexPath(request: IndexRequest, roots: ArtifactRoots): string;
/** Resolve a requested workspace within the physical session boundary without indexing it. */
export declare function resolveContainedWorkspaceRoot(context: ArtifactExecutionContextV1, request?: Pick<IndexRequest, "workspaceRoot">): Promise<string>;
export declare function buildOrRefreshIndex(request: IndexRequest, context: ArtifactExecutionContextV1, profiles?: readonly ArtifactProfileV1[], failureInjector?: FailureInjector): Promise<RefreshResult>;
/** A bounded, safe summary of the top-level metadata actually indexed. */
export declare function observedFieldCatalog(index: ArtifactIndexV1): ObservedFieldCatalog;
export declare function inspectIndexOwnership(indexPath: string): Promise<{
    kind: "absent";
} | {
    kind: "canonical";
    index: ArtifactIndexV1;
} | {
    kind: "legacy";
} | {
    kind: "occupied";
    reason: string;
}>;
export declare function validateArtifactIndexV1(value: unknown): ArtifactIndexV1;
export declare function markIndexesDirtyForPath(cwd: string, rawPath: unknown): void;
export declare function trackArtifactToolResult(event: unknown, cwd: string): void;
export declare function commandMayMutateArtifacts(command: unknown): boolean;
/** Removes credentials from metadata returned to callers while preserving safe fields. */
export declare function safeFrontmatterForDisplay(frontmatter: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;
