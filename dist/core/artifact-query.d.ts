import type { ArtifactProfileV1, ArtifactSearchRequestV1 } from "../contracts/v1/index.js";
import type { ArtifactIndexV1, ArtifactKind } from "./artifact-index.js";
export type ArtifactSearchItem = Readonly<{
    path: string;
    kind: ArtifactKind;
    title?: string;
    score: number;
    snippet?: string;
    frontmatter: Readonly<Record<string, unknown>>;
    reasons: readonly string[];
    related?: readonly RelatedArtifact[];
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
    allowedFilterFields: readonly string[];
}>;
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
export declare function controlsFor(request: ArtifactSearchRequestV1, allowedFilterFields: readonly string[]): Readonly<Record<string, unknown>>;
//# sourceMappingURL=artifact-query.d.ts.map