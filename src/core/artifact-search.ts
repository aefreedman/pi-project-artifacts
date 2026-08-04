import type {
  ArtifactDescribeRequestV1,
  ArtifactExecutionContextV1,
  ArtifactExecutionProvenanceV1,
  ArtifactProfileV1,
  ArtifactSearchRequestV1,
  ArtifactSearchResultV1,
  ContractResolutionV1,
} from "../contracts/v1/index.js";
import type { RegistryRecord } from "@aefree/pi-capability-registry";
import { artifactCacheState, buildOrRefreshIndex, observedFieldCatalog, type ArtifactCacheState, type ObservedFieldCatalog, type RefreshResult } from "./artifact-index.js";
import { BODY_PREVIEW_SEARCH_CHARS, controlsFor, describeArtifactFields, formatArtifactResults, searchArtifactIndex, suggestedRg, type ArtifactFieldDescription } from "./artifact-query.js";

const MAX_DESCRIBE_FIELD_NAMES = 20;

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
      query: boundedText(request.query),
      scopes: request.scopes ?? ["all"],
      filterRequest: boundedFilterRequest(request.filters),
      indexPath: refresh.indexPath.replaceAll("\\", "/"),
      refreshed: refresh.refreshed,
      fastPath: refresh.fastPath,
      cacheState,
      freshnessMode: refresh.freshnessMode,
      refreshStats: refresh.stats,
      rootIdentity: refresh.index.rootIdentity,
      orphanTempsRemoved: boundedList(refresh.orphanTempsRemoved.map((entry) => entry.replaceAll("\\", "/")), 8),
      totalIndexedFiles: Object.keys(refresh.index.files).length,
      resultCount: query.totalMatches,
      preparedResultCount: query.preparedMatches,
      returnedResultCount: returned.length,
      results: returned,
      groupCounts: request.groupByKind ? groupCounts(returned) : undefined,
      suggestedRg: suggestedRg(request),
      searchCoverage: Object.freeze({ body: Object.freeze({ mode: "preview_only", indexedCharactersPerDocument: BODY_PREVIEW_SEARCH_CHARS, exhaustiveSearch: "Run suggestedRg and then read matching Markdown files directly; terms beyond the preview are not indexed." }) }),
      filtering: Object.freeze({ exactNormalizedMatching: true, schemaOpen: true, knownProfileFieldCount: query.fieldDefinitions.length }),
      validationDiagnostics: validationDiagnostics(refresh.index, returned.map((entry) => entry.path)),
      controls: controlsFor(request),
    }),
    provenance,
  });
}

export function buildProvenance(
  index: RefreshResult["index"],
  profiles: readonly ArtifactProfileV1[],
  resolution: ArtifactProfileResolution,
): ArtifactExecutionProvenanceV1 {
  const allProfileRows = profiles.map((profile) => Object.freeze({
    profileId: profile.id,
    packageName: profile.owner.packageName,
    packageVersion: profile.owner.packageVersion,
    contractVersion: 1 as const,
    decision: Object.values(index.files).some((entry) => entry.profileData.some((data) => data.profileId === profile.id
      && data.packageName === profile.owner.packageName && data.packageVersion === profile.owner.packageVersion))
      ? "applied" as const
      : "not_applicable" as const,
  })).sort((left, right) => left.profileId.localeCompare(right.profileId));
  const profileRows = allProfileRows.slice(0, 8);
  const fallbacks: { code: string; action: "used" | "blocked" | "not_needed"; summary: string }[] = [];
  if (resolution.outcome === "missing") fallbacks.push({ code: "artifact_profiles_missing", action: "used", summary: "Generic artifact search continued without optional artifact profiles." });
  else if (resolution.outcome === "incompatible") fallbacks.push({ code: "artifact_profiles_incompatible", action: "used", summary: "Raw metadata search continued without incompatible optional artifact profiles." });
  else if (resolution.outcome === "duplicate") fallbacks.push({ code: "artifact_profiles_duplicate", action: "blocked", summary: "Duplicate artifact profiles are not safe to compose." });
  else fallbacks.push({ code: "artifact_profiles_available", action: "not_needed", summary: "Compatible artifact profiles were resolved at execution time." });
  return Object.freeze({
    schema: "@aefree/pi-project-artifacts/execution-provenance",
    version: 1,
    canonical: Object.freeze({ serviceId: ARTIFACT_SEARCH_SERVICE_ID, packageName: ARTIFACTS_PACKAGE_NAME, packageVersion: ARTIFACTS_PACKAGE_VERSION, contractVersion: 1 }),
    profiles: Object.freeze(profileRows),
    profileSummary: Object.freeze({ total: allProfileRows.length, returned: profileRows.length, omitted: Math.max(0, allProfileRows.length - profileRows.length), truncated: allProfileRows.length > profileRows.length }),
    fallbacks: Object.freeze(fallbacks),
    executionGate: resolution.outcome === "duplicate" ? "blocked" : "executed",
  });
}

function validationDiagnostics(index: RefreshResult["index"], returnedPaths: readonly string[]): Readonly<Record<string, unknown>> {
  const summarize = (entries: readonly { path: string; profileData: readonly { profileId: string; validation: { outcome: string } }[] }[]) => {
    const byOutcome: Record<string, number> = { valid: 0, invalid: 0, conflict: 0, unavailable: 0, error: 0 };
    const warnings: { path: string; profileId: string; outcome: string }[] = [];
    for (const entry of entries) for (const profile of entry.profileData) {
      byOutcome[profile.validation.outcome] = (byOutcome[profile.validation.outcome] ?? 0) + 1;
      if (profile.validation.outcome !== "valid") warnings.push({ path: entry.path, profileId: profile.profileId, outcome: profile.validation.outcome });
    }
    warnings.sort((left, right) => left.path.localeCompare(right.path) || left.profileId.localeCompare(right.profileId));
    const evidence = warnings.slice(0, 8);
    return Object.freeze({ byOutcome: Object.freeze(byOutcome), warningTotal: warnings.length, warningEvidence: Object.freeze(evidence), warningEvidenceReturned: evidence.length, warningEvidenceOmitted: Math.max(0, warnings.length - evidence.length), warningEvidenceTruncated: warnings.length > evidence.length });
  };
  const returned = returnedPaths.flatMap((entryPath) => {
    const entry = index.files[entryPath];
    return entry === undefined ? [] : [{ path: entry.path, profileData: entry.profileData }];
  });
  return Object.freeze({ indexed: summarize(Object.values(index.files).map((entry) => ({ path: entry.path, profileData: entry.profileData }))), returned: summarize(returned) });
}

function groupCounts(results: readonly { kind: string }[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const result of results) counts[result.kind] = (counts[result.kind] ?? 0) + 1;
  return Object.freeze(Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))));
}
function boundedFilterRequest(filters: ArtifactSearchRequestV1["filters"]): Readonly<{ total: number; fields: readonly string[]; omitted: number; truncated: boolean }> {
  const all = Object.keys(filters ?? {}).sort();
  const fields = all.slice(0, 8);
  return Object.freeze({ total: all.length, fields: Object.freeze(fields), omitted: Math.max(0, all.length - fields.length), truncated: all.length > fields.length });
}
function boundedText(value: string | undefined): Readonly<{ value?: string; truncated: boolean }> {
  if (value === undefined) return Object.freeze({ truncated: false });
  const limit = 240;
  return Object.freeze({ value: value.slice(0, limit), truncated: value.length > limit });
}
function boundedList(values: readonly string[], limit: number): Readonly<{ items: readonly string[]; total: number; omitted: number; truncated: boolean }> {
  const items = values.slice(0, limit);
  return Object.freeze({ items: Object.freeze(items), total: values.length, omitted: Math.max(0, values.length - items.length), truncated: values.length > items.length });
}
function normalizeDescribeRequest(request: ArtifactDescribeRequestV1): Required<Pick<ArtifactDescribeRequestV1, "outputMode" | "includeSamples">> & ArtifactDescribeRequestV1 {
  const outputMode = request.outputMode ?? "compact";
  if (outputMode !== "compact" && outputMode !== "detailed") throw new TypeError("describe outputMode must be compact or detailed");
  const includeSamples = request.includeSamples === true;
  if (request.includeSamples !== undefined && typeof request.includeSamples !== "boolean") throw new TypeError("describe includeSamples must be boolean");
  if (request.fieldNames !== undefined && !Array.isArray(request.fieldNames)) throw new TypeError("describe fieldNames must be an array");
  const fieldNames = request.fieldNames?.map((field) => {
    if (typeof field !== "string" || field.trim() === "" || field !== field.trim() || !/^[A-Za-z0-9_-]+$/u.test(field)) throw new TypeError("describe fieldNames must contain non-empty exact top-level field names");
    return field;
  });
  if (fieldNames !== undefined && (fieldNames.length === 0 || fieldNames.length > MAX_DESCRIBE_FIELD_NAMES)) throw new TypeError(`describe fieldNames must contain 1-${MAX_DESCRIBE_FIELD_NAMES} names`);
  if (fieldNames !== undefined && new Set(fieldNames).size !== fieldNames.length) throw new TypeError("describe fieldNames must not contain duplicates");
  if (includeSamples && outputMode !== "detailed") throw new TypeError("describe includeSamples requires outputMode detailed");
  if (includeSamples && fieldNames === undefined) throw new TypeError("describe includeSamples requires a non-empty focused fieldNames list");
  return Object.freeze({ ...request, outputMode, includeSamples, ...(fieldNames === undefined ? {} : { fieldNames: Object.freeze([...fieldNames].sort((left, right) => left.localeCompare(right))) }) });
}

/** A deterministic agent-facing summary, deliberately smaller than structured details. */
export function formatArtifactWorkspaceDescription(description: ArtifactWorkspaceDescription): string {
  const definitions = description.fields.map((field) => {
    const owner = field.owner.kind === "profile" ? `; profile=${field.owner.profileId ?? field.owner.packageName}` : "; generic";
    return `${field.name} (${field.type}${owner})`;
  }).join("\n");
  const availability = description.profileAvailability.map((profile) => `${profile.profileId}=${profile.decision}`).join("; ");
  const catalog = description.observedFieldCatalog;
  const observed = catalog.fields.map((field) => `${field.name} (${field.documentCount})${field.sampleValues ? `: ${field.sampleValues.join(", ") || "[suppressed]"}` : ""}`).join("\n");
  return [
    `Describe mode=${description.outputMode}; samples=${description.samplesIncluded ? "included" : "omitted"}.`,
    `Known field definitions (${description.fields.length}):`,
    definitions || "(none)",
    `Profile availability (${description.profileAvailability.length}): ${availability || "none"}`,
    `Observed fields: ${catalog.returnedFieldCount}/${catalog.totalFieldCount}; omitted=${catalog.omittedFieldCount}; truncated=${catalog.truncated}.`,
    observed || "(none)",
  ].join("\n");
}

export type ArtifactWorkspaceDescription = Readonly<{
  workspaceRoot: string;
  fields: readonly ArtifactFieldDescription[];
  profileAvailability: readonly { profileId: string; packageName: string; packageVersion: string; decision: "applied" | "not_applicable" | "blocked" }[];
  profileResolution: Readonly<Record<string, unknown>>;
  observedFieldCatalog: ObservedFieldCatalog;
  outputMode: "compact" | "detailed";
  samplesIncluded: boolean;
  focusedFieldNames?: readonly string[];
  indexPath: string;
  refreshed: boolean;
  fastPath: boolean;
  cacheState: ArtifactCacheState;
  freshnessMode: RefreshResult["freshnessMode"];
  refreshStats: RefreshResult["stats"];
}>;

/** Canonical describe path: use the same contained, disposable index as search. */
export async function describeArtifactWorkspace(
  context: ArtifactExecutionContextV1,
  request: ArtifactDescribeRequestV1,
  profileResolution: ArtifactProfileResolution,
): Promise<ArtifactWorkspaceDescription> {
  const describeRequest = normalizeDescribeRequest(request);
  const profiles = profileResolution.outcome === "available" ? profileResolution.records : [];
  const refresh = await buildOrRefreshIndex(describeRequest, context, profiles);
  const applied = new Set(Object.values(refresh.index.files).flatMap((entry) => entry.profileData.map((data) => `${data.profileId}\0${data.packageName}\0${data.packageVersion}`)));
  const applicable = profiles.filter((profile) => applied.has(`${profile.id}\0${profile.owner.packageName}\0${profile.owner.packageVersion}`));
  const profileAvailability = profiles.map((profile) => Object.freeze({
    profileId: profile.id, packageName: profile.owner.packageName, packageVersion: profile.owner.packageVersion,
    decision: applied.has(`${profile.id}\0${profile.owner.packageName}\0${profile.owner.packageVersion}`) ? "applied" as const : "not_applicable" as const,
  })).sort((left, right) => left.profileId.localeCompare(right.profileId));
  return Object.freeze({
    workspaceRoot: refresh.index.workspaceRoot,
    fields: describeArtifactFields(applicable),
    profileAvailability: Object.freeze(profileAvailability),
    profileResolution: Object.freeze({ outcome: profileResolution.outcome, providerIds: profileResolution.outcome === "available" ? profiles.map((profile) => profile.id).sort() : profileResolution.providerIds }),
    observedFieldCatalog: observedFieldCatalog(refresh.index, {
      ...(describeRequest.fieldNames === undefined ? {} : { fieldNames: describeRequest.fieldNames }),
      detailed: describeRequest.outputMode === "detailed",
      includeSamples: describeRequest.includeSamples === true,
    }),
    outputMode: describeRequest.outputMode,
    samplesIncluded: describeRequest.includeSamples === true,
    ...(describeRequest.fieldNames === undefined ? {} : { focusedFieldNames: describeRequest.fieldNames }),
    indexPath: refresh.indexPath.replaceAll("\\", "/"),
    refreshed: refresh.refreshed,
    fastPath: refresh.fastPath,
    cacheState: artifactCacheState(refresh),
    freshnessMode: refresh.freshnessMode,
    refreshStats: refresh.stats,
  });
}

export function requireComposableProfiles(resolution: ArtifactProfileResolution): void {
  if (resolution.outcome === "duplicate") {
    throw new Error(`duplicate_profile: Multiple artifact-profile registrations conflict (${resolution.providerIds.join(", ")}).`);
  }
}
