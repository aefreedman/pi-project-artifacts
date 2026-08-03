import type { ArtifactExecutionContextV1, ArtifactExecutionProvenanceV1, ArtifactProfileV1, ArtifactSearchRequestV1, ArtifactSearchResultV1, ContractResolutionV1 } from "../contracts/v1/index.js";
import { type IndexRequest, type ObservedFieldCatalog, type RefreshResult } from "./artifact-index.js";
import { type ArtifactFieldDescription } from "./artifact-query.js";
export declare const ARTIFACT_SEARCH_SERVICE_ID: "project-artifact-search.v1";
export declare const ARTIFACTS_PACKAGE_NAME: "@aefree/pi-project-artifacts";
export declare const ARTIFACTS_PACKAGE_VERSION: "0.1.0";
export type ArtifactProfileResolution = ContractResolutionV1<ArtifactProfileV1>;
/** Canonical search composition. It never imports a provider package. */
export declare function executeArtifactSearch(context: ArtifactExecutionContextV1, request: ArtifactSearchRequestV1, profileResolution: ArtifactProfileResolution): Promise<ArtifactSearchResultV1>;
export declare function buildProvenance(index: RefreshResult["index"], profiles: readonly ArtifactProfileV1[], resolution: ArtifactProfileResolution): ArtifactExecutionProvenanceV1;
export type ArtifactWorkspaceDescription = Readonly<{
    workspaceRoot: string;
    fields: readonly ArtifactFieldDescription[];
    profileAvailability: readonly {
        profileId: string;
        packageName: string;
        packageVersion: string;
        decision: "applied" | "not_applicable" | "blocked";
    }[];
    profileResolution: Readonly<Record<string, unknown>>;
    observedFieldCatalog: ObservedFieldCatalog;
    indexPath: string;
    refreshed: boolean;
    refreshStats: RefreshResult["stats"];
}>;
/** Canonical describe path: use the same contained, disposable index as search. */
export declare function describeArtifactWorkspace(context: ArtifactExecutionContextV1, request: IndexRequest, profileResolution: ArtifactProfileResolution): Promise<ArtifactWorkspaceDescription>;
export declare function requireComposableProfiles(resolution: ArtifactProfileResolution): void;
