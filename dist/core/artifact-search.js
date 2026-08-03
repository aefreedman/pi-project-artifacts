import { artifactCacheState, buildOrRefreshIndex, observedFieldCatalog } from "./artifact-index.js";
import { BODY_PREVIEW_SEARCH_CHARS, controlsFor, describeArtifactFields, formatArtifactResults, groupByKind, searchArtifactIndex, suggestedRg } from "./artifact-query.js";
export const ARTIFACT_SEARCH_SERVICE_ID = "project-artifact-search.v1";
export const ARTIFACTS_PACKAGE_NAME = "@aefree/pi-project-artifacts";
export const ARTIFACTS_PACKAGE_VERSION = "0.1.0";
/** Canonical search composition. It never imports a provider package. */
export async function executeArtifactSearch(context, request, profileResolution) {
    const profiles = profileResolution.outcome === "available" ? profileResolution.records : [];
    const refresh = await buildOrRefreshIndex(request, context, profiles);
    // Definitions enrich per-result confidence, but never gate raw metadata matching.
    const query = searchArtifactIndex(refresh.index, request, profiles);
    const limit = Math.max(1, Math.min(request.limit ?? 20, 100));
    const returned = query.results.slice(0, limit);
    const provenance = buildProvenance(refresh.index, profiles, profileResolution);
    const cacheState = artifactCacheState(refresh);
    const text = formatArtifactResults(query, request, {
        indexPath: refresh.indexPath.replaceAll("\\", "/"),
        cacheState,
        freshnessMode: refresh.freshnessMode,
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
            cacheState,
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
            searchCoverage: Object.freeze({ body: Object.freeze({ mode: "preview_only", indexedCharactersPerDocument: BODY_PREVIEW_SEARCH_CHARS, exhaustiveSearch: "Run suggestedRg and then read matching Markdown files directly; terms beyond the preview are not indexed." }) }),
            fieldDefinitions: query.fieldDefinitions,
            observedFieldCatalog: observedFieldCatalog(refresh.index),
            validationDiagnostics: validationDiagnostics(refresh.index, returned),
            controls: controlsFor(request, query.fieldDefinitions),
        }),
        provenance,
    });
}
export function buildProvenance(index, profiles, resolution) {
    const profileRows = profiles.map((profile) => Object.freeze({
        profileId: profile.id,
        packageName: profile.owner.packageName,
        packageVersion: profile.owner.packageVersion,
        contractVersion: 1,
        decision: Object.values(index.files).some((entry) => entry.profileData.some((data) => data.profileId === profile.id
            && data.packageName === profile.owner.packageName && data.packageVersion === profile.owner.packageVersion))
            ? "applied"
            : "not_applicable",
    })).sort((left, right) => left.profileId.localeCompare(right.profileId));
    const fallbacks = [];
    if (resolution.outcome === "missing")
        fallbacks.push({ code: "artifact_profiles_missing", action: "used", summary: "Generic artifact search continued without optional artifact profiles." });
    else if (resolution.outcome === "incompatible")
        fallbacks.push({ code: "artifact_profiles_incompatible", action: "used", summary: "Raw metadata search continued without incompatible optional artifact profiles." });
    else if (resolution.outcome === "duplicate")
        fallbacks.push({ code: "artifact_profiles_duplicate", action: "blocked", summary: "Duplicate artifact profiles are not safe to compose." });
    else
        fallbacks.push({ code: "artifact_profiles_available", action: "not_needed", summary: "Compatible artifact profiles were resolved at execution time." });
    return Object.freeze({
        schema: "@aefree/pi-project-artifacts/execution-provenance",
        version: 1,
        canonical: Object.freeze({ serviceId: ARTIFACT_SEARCH_SERVICE_ID, packageName: ARTIFACTS_PACKAGE_NAME, packageVersion: ARTIFACTS_PACKAGE_VERSION, contractVersion: 1 }),
        profiles: Object.freeze(profileRows),
        fallbacks: Object.freeze(fallbacks),
        executionGate: resolution.outcome === "duplicate" ? "blocked" : "executed",
    });
}
function validationDiagnostics(index, returned) {
    const summarize = (entries) => {
        const byOutcome = { valid: 0, invalid: 0, conflict: 0, unavailable: 0, error: 0 };
        const diagnostics = [];
        for (const entry of entries)
            for (const profile of entry.profileValidation) {
                byOutcome[profile.validation.outcome] = (byOutcome[profile.validation.outcome] ?? 0) + 1;
                if (profile.validation.outcome !== "valid")
                    diagnostics.push({ path: entry.path, profileId: profile.profileId, packageName: profile.packageName, packageVersion: profile.packageVersion, outcome: profile.validation.outcome, validation: profile.validation });
            }
        diagnostics.sort((left, right) => left.path.localeCompare(right.path) || left.profileId.localeCompare(right.profileId));
        return Object.freeze({ byOutcome: Object.freeze(byOutcome), diagnostics: Object.freeze(diagnostics) });
    };
    return Object.freeze({ indexed: summarize(Object.values(index.files).map((entry) => ({ path: entry.path, profileValidation: entry.profileData }))), returned: summarize(returned) });
}
/** Canonical describe path: use the same contained, disposable index as search. */
export async function describeArtifactWorkspace(context, request, profileResolution) {
    const profiles = profileResolution.outcome === "available" ? profileResolution.records : [];
    const refresh = await buildOrRefreshIndex(request, context, profiles);
    const applied = new Set(Object.values(refresh.index.files).flatMap((entry) => entry.profileData.map((data) => `${data.profileId}\0${data.packageName}\0${data.packageVersion}`)));
    const applicable = profiles.filter((profile) => applied.has(`${profile.id}\0${profile.owner.packageName}\0${profile.owner.packageVersion}`));
    const profileAvailability = profiles.map((profile) => Object.freeze({
        profileId: profile.id, packageName: profile.owner.packageName, packageVersion: profile.owner.packageVersion,
        decision: applied.has(`${profile.id}\0${profile.owner.packageName}\0${profile.owner.packageVersion}`) ? "applied" : "not_applicable",
    })).sort((left, right) => left.profileId.localeCompare(right.profileId));
    return Object.freeze({
        workspaceRoot: refresh.index.workspaceRoot,
        fields: describeArtifactFields(applicable),
        profileAvailability: Object.freeze(profileAvailability),
        profileResolution: Object.freeze({ outcome: profileResolution.outcome, providerIds: profileResolution.outcome === "available" ? profiles.map((profile) => profile.id).sort() : profileResolution.providerIds }),
        observedFieldCatalog: observedFieldCatalog(refresh.index),
        indexPath: refresh.indexPath.replaceAll("\\", "/"),
        refreshed: refresh.refreshed,
        fastPath: refresh.fastPath,
        cacheState: artifactCacheState(refresh),
        freshnessMode: refresh.freshnessMode,
        refreshStats: refresh.stats,
    });
}
export function requireComposableProfiles(resolution) {
    if (resolution.outcome === "duplicate") {
        throw new Error(`duplicate_profile: Multiple artifact-profile registrations conflict (${resolution.providerIds.join(", ")}).`);
    }
}
