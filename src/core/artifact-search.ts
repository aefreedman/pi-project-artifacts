import type {
  ArtifactExecutionContextV1,
  ArtifactExecutionProvenanceV1,
  ArtifactProfileV1,
  ArtifactSearchRequestV1,
  ArtifactSearchResultV1,
  ContractResolutionV1,
} from "../contracts/v1/index.js";
import type { RegistryRecord } from "@aefree/pi-capability-registry";
import { buildOrRefreshIndex, type RefreshResult } from "./artifact-index.js";
import { controlsFor, formatArtifactResults, groupByKind, searchArtifactIndex, suggestedRg } from "./artifact-query.js";

export const ARTIFACT_SEARCH_SERVICE_ID = "project-artifact-search.v1" as const;
export const ARTIFACTS_PACKAGE_NAME = "@aefree/pi-project-artifacts" as const;
export const ARTIFACTS_PACKAGE_VERSION = "0.1.0" as const;

export type ArtifactProfileResolution = ContractResolutionV1<ArtifactProfileV1>;

/** Canonical search composition. It never imports a provider package. */
export async function executeArtifactSearch(
  context: ArtifactExecutionContextV1,
  request: ArtifactSearchRequestV1,
  profileResolution: ArtifactProfileResolution,
): Promise<ArtifactSearchResultV1> {
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

export function buildProvenance(
  request: ArtifactSearchRequestV1,
  profiles: readonly ArtifactProfileV1[],
  resolution: ArtifactProfileResolution,
): ArtifactExecutionProvenanceV1 {
  const profileRows = profiles.map((profile) => Object.freeze({
    profileId: profile.id,
    packageName: profile.owner.packageName,
    packageVersion: profile.owner.packageVersion,
    contractVersion: 1 as const,
    decision: "applied" as const,
  })).sort((left, right) => left.profileId.localeCompare(right.profileId));
  const fallbacks: { code: string; action: "used" | "blocked" | "not_needed"; summary: string }[] = [];
  if (resolution.outcome === "missing") fallbacks.push({ code: "artifact_profiles_missing", action: "used", summary: "Generic artifact search continued without optional artifact profiles." });
  else if (resolution.outcome === "incompatible") fallbacks.push({ code: "artifact_profiles_incompatible", action: "used", summary: "Generic artifact search continued without incompatible artifact profiles; profile-defined filters remain blocked." });
  else if (resolution.outcome === "duplicate") fallbacks.push({ code: "artifact_profiles_duplicate", action: "blocked", summary: "Duplicate artifact profiles are not safe to compose." });
  else fallbacks.push({ code: "artifact_profiles_available", action: "not_needed", summary: "Compatible artifact profiles were resolved at execution time." });
  return Object.freeze({
    schema: "@aefree/pi-project-artifacts/execution-provenance",
    version: 1,
    canonical: Object.freeze({ serviceId: ARTIFACT_SEARCH_SERVICE_ID, packageName: ARTIFACTS_PACKAGE_NAME, packageVersion: ARTIFACTS_PACKAGE_VERSION, contractVersion: 1 }),
    profiles: Object.freeze(profileRows),
    fallbacks: Object.freeze(fallbacks),
    executionGate: resolution.outcome === "duplicate" ? "blocked" : "executed",
  });
}

export function requireComposableProfiles(resolution: ArtifactProfileResolution): void {
  if (resolution.outcome === "duplicate") {
    throw new Error(`duplicate_profile: Multiple artifact-profile registrations conflict (${resolution.providerIds.join(", ")}).`);
  }
}
