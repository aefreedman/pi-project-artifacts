import type { ArtifactExecutionContextV1, ArtifactProfileV1, ArtifactValidationResultV1 } from "../contracts/v1/index.js";
import { type FailureInjector } from "./atomic.js";
import { type ArtifactRoots } from "./roots.js";
export declare const ARTIFACT_INDEX_SCHEMA: "@aefree/pi-project-artifacts/index";
export declare const ARTIFACT_INDEX_VERSION: 1;
export type ArtifactKind = "doc" | "solution" | "plan" | "todo" | "other-doc";
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
export type IndexRequest = Readonly<{
    workspaceRoot?: string;
    docsRoot?: string;
    todosRoot?: string;
    indexPath?: string;
    freshnessMode?: FreshnessMode;
    freshnessTtlMs?: number;
    rebuild?: boolean;
}>;
export declare function defaultIndexFilename(roots: ArtifactRoots): string;
export declare function resolveIndexPath(request: IndexRequest, roots: ArtifactRoots): string;
export declare function buildOrRefreshIndex(request: IndexRequest, context: ArtifactExecutionContextV1, profiles?: readonly ArtifactProfileV1[], failureInjector?: FailureInjector): Promise<RefreshResult>;
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
//# sourceMappingURL=artifact-index.d.ts.map