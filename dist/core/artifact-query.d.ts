import type { ArtifactFieldDefinitionV1, ArtifactProfileV1, ArtifactSearchRequestV1 } from "../contracts/v1/index.js";
import { type ArtifactCacheState, type ArtifactIndexV1, type ArtifactKind, type FreshnessMode } from "./artifact-index.js";
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
export type FilterFieldSemantics = Readonly<{
    field: string;
    confidence: "raw_exact" | "profile_validated" | "profile_warning";
    profiles: readonly Readonly<{
        profileId: string;
        outcome: "valid" | "invalid" | "conflict" | "unavailable" | "error";
    }>[];
    totalProfiles: number;
    omittedProfiles: number;
    profilesTruncated: boolean;
}>;
export type FilterSemanticsSummary = Readonly<{
    items: readonly FilterFieldSemantics[];
    total: number;
    omitted: number;
    truncated: boolean;
}>;
export type ArtifactMetadataFacet = Readonly<{
    field: string;
    values: readonly string[];
    totalValues: number;
    omittedValues: number;
    truncated: boolean;
}>;
export type ArtifactMetadataFacets = Readonly<{
    items: readonly ArtifactMetadataFacet[];
    total: number;
    omitted: number;
    truncated: boolean;
}>;
export type ProfileValidationEvidence = Readonly<{
    profileId: string;
    outcome: "valid" | "invalid" | "conflict" | "unavailable" | "error";
}>;
export type ProfileValidationSummary = Readonly<{
    items: readonly ProfileValidationEvidence[];
    total: number;
    omitted: number;
    truncated: boolean;
}>;
export type ArtifactSearchItem = Readonly<{
    path: string;
    kind: ArtifactKind;
    title?: string;
    score: number;
    snippet?: string;
    /** Query-relevant safe metadata only; full frontmatter remains source-only. */
    metadataFacets: ArtifactMetadataFacets;
    reasons: readonly string[];
    related?: readonly RelatedArtifact[];
    /** Bounded outcome-only profile evidence; validation payloads remain internal. */
    profileValidation: ProfileValidationSummary;
    filterSemantics?: FilterSemanticsSummary;
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
    cacheState: ArtifactCacheState;
    freshnessMode: FreshnessMode;
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
export declare function controlsFor(request: ArtifactSearchRequestV1): Readonly<Record<string, unknown>>;
