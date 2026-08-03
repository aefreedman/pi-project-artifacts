import type { ArtifactFieldDefinitionV1, ArtifactProfileV1, ArtifactSearchRequestV1 } from "../contracts/v1/index.js";
import type { ArtifactIndexV1, ArtifactKind, ProfileEntryData } from "./artifact-index.js";
export declare const BODY_PREVIEW_SEARCH_CHARS = 1200;
export type ArtifactFieldDescription = Readonly<{
    name: string;
    owner: Readonly<{
        kind: "generic" | "profile";
        profileId?: string;
        packageName: string;
        packageVersion: string;
    }>;
    type: ArtifactFieldDefinitionV1["type"];
    indexed: boolean;
    filterable: boolean;
    required: boolean;
    enumValues: readonly string[];
}>;
export type ArtifactSearchItem = Readonly<{
    path: string;
    kind: ArtifactKind;
    title?: string;
    score: number;
    snippet?: string;
    frontmatter: Readonly<Record<string, unknown>>;
    reasons: readonly string[];
    related?: readonly RelatedArtifact[];
    profileValidation: readonly ProfileEntryData[];
}>;
export type RelatedArtifact = Readonly<{
    path: string;
    kind: ArtifactKind;
    title?: string;
    relation: "linksTo" | "linkedFrom";
}>;
export type ArtifactQueryResult = Readonly<{
    results: readonly ArtifactSearchItem[];
    totalMatches: number;
    preparedMatches: number;
    fieldDefinitions: readonly ArtifactFieldDescription[];
}>;
export declare function describeArtifactFields(profiles: readonly ArtifactProfileV1[]): readonly ArtifactFieldDescription[];
export declare function searchArtifactIndex(index: ArtifactIndexV1, request: ArtifactSearchRequestV1, profiles: readonly ArtifactProfileV1[]): ArtifactQueryResult;
export declare function formatArtifactResults(result: ArtifactQueryResult, request: ArtifactSearchRequestV1, metadata: {
    indexPath: string;
    refreshed: boolean;
    stats: {
        added: number;
        updated: number;
        removed: number;
        unchanged: number;
    };
    totalFiles: number;
}): string;
export declare function groupByKind(results: readonly ArtifactSearchItem[]): Readonly<Record<string, readonly ArtifactSearchItem[]>>;
export declare function suggestedRg(request: ArtifactSearchRequestV1): string | undefined;
export declare function controlsFor(request: ArtifactSearchRequestV1, fieldDefinitions: readonly ArtifactFieldDescription[]): Readonly<Record<string, unknown>>;
//# sourceMappingURL=artifact-query.d.ts.map