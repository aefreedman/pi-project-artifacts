import { buildOrRefreshIndex } from "./artifact-index.js";
import { controlsFor, formatArtifactResults, groupByKind, searchArtifactIndex, suggestedRg } from "./artifact-query.js";
export const ARTIFACT_SEARCH_SERVICE_ID = "project-artifact-search.v1";
export const ARTIFACTS_PACKAGE_NAME = "@aefree/pi-project-artifacts";
export const ARTIFACTS_PACKAGE_VERSION = "0.1.0";
/** Canonical search composition. It never imports a provider package. */
export async function executeArtifactSearch(context, request, profileResolution) {
    const profiles = profileResolution.outcome === "available" ? profileResolution.records : [];
    const refresh = await buildOrRefreshIndex(request, context, profiles);
    const query = searchArtifactIndex(refresh.index, request, profiles);
    const limit = Math.max(1, Math.min(request.limit ?? 20, 100));
    const returned = query.results.slice(0, limit);
    const provenance = buildProvenance(request, profiles, profileResolution);
    const text = formatArtifactResults(query, request, {
        indexPath: refresh.indexPath.replaceAll("\\", "/"),
        refreshed: refresh.refreshed,
        stats: refresh.stats,
        totalFiles: Object.keys(refresh.index.files).length,
    });
    return Object.freeze({
        text,
        details: Object.freeze({
            query: request.query,
            requiredTerms: request.requiredTerms,
            optionalTerms: request.optionalTerms,
            scopes: request.scopes ?? ["all"],
            filters: request.filters ?? {},
            indexPath: refresh.indexPath.replaceAll("\\", "/"),
            refreshed: refresh.refreshed,
            fastPath: refresh.fastPath,
            freshnessMode: refresh.freshnessMode,
            refreshStats: refresh.stats,
            rootIdentity: refresh.index.rootIdentity,
            orphanTempsRemoved: refresh.orphanTempsRemoved.map((entry) => entry.replaceAll("\\", "/")),
            totalIndexedFiles: Object.keys(refresh.index.files).length,
            resultCount: query.totalMatches,
            preparedResultCount: query.preparedMatches,
            returnedResultCount: returned.length,
            results: returned,
            groups: request.groupByKind ? groupByKind(returned) : undefined,
            suggestedRg: suggestedRg(request),
            controls: controlsFor(request, query.allowedFilterFields),
        }),
        provenance,
    });
}
export function buildProvenance(request, profiles, resolution) {
    const profileRows = profiles.map((profile) => Object.freeze({
        profileId: profile.id,
        packageName: profile.owner.packageName,
        packageVersion: profile.owner.packageVersion,
        contractVersion: 1,
        decision: "applied",
    })).sort((left, right) => left.profileId.localeCompare(right.profileId));
    const fallbacks = [];
    if (resolution.outcome === "missing")
        fallbacks.push({ code: "artifact_profiles_missing", action: "used", summary: "Generic artifact search continued without optional artifact profiles." });
    else if (resolution.outcome === "incompatible")
        fallbacks.push({ code: "artifact_profiles_incompatible", action: "used", summary: "Generic artifact search continued without incompatible artifact profiles; profile-defined filters remain blocked." });
    else if (resolution.outcome === "duplicate")
        fallbacks.push({ code: "artifact_profiles_duplicate", action: "blocked", summary: "Duplicate artifact profiles are not safe to compose." });
    else
        fallbacks.push({ code: "artifact_profiles_available", action: "not_needed", summary: "Compatible artifact profiles were resolved at execution time." });
    return Object.freeze({
        schema: "@aefree/pi-project-artifacts/execution-provenance",
        version: 1,
        canonical: Object.freeze({ serviceId: ARTIFACT_SEARCH_SERVICE_ID, packageName: ARTIFACTS_PACKAGE_NAME, packageVersion: ARTIFACTS_PACKAGE_VERSION, contractVersion: 1 }),
        ...(request.compatibility === undefined ? {} : { compatibility: request.compatibility }),
        profiles: Object.freeze(profileRows),
        fallbacks: Object.freeze(fallbacks),
        executionGate: resolution.outcome === "duplicate" ? "blocked" : "executed",
    });
}
export function requireComposableProfiles(resolution) {
    if (resolution.outcome === "duplicate") {
        throw new Error(`duplicate_profile: Multiple artifact-profile registrations conflict (${resolution.providerIds.join(", ")}).`);
    }
}
//# sourceMappingURL=artifact-search.js.map