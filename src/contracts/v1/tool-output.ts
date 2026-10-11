import { Type, type TSchema } from "typebox";

export const NATIVE_OUTPUT_BYTES_V1 = 65_536;
export const PRESENTATION_BYTES_V1 = 32_768;
export const DETAILS_BYTES_V1 = 65_536;
const object = (properties: Record<string, TSchema>) => Type.Object(properties, { additionalProperties: false });
const count = Type.Integer({ minimum: 0 });
const label = Type.String({ maxLength: 256 });
const description = Type.String({ maxLength: 240 });
const reference = Type.String({ minLength: 1, maxLength: 4096 });
const hash = Type.String({ pattern: "^sha256:[a-f0-9]{64}$" });
const array = (item: TSchema, maxItems: number) => Type.Array(item, { maxItems });
const enumeration = (values: string[]) => Type.Union(values.map(value => Type.Literal(value)));
const accounting = { total: count, returned: count, omitted: count };
const profileEvidence = object({ profileId: label, outcome: enumeration(["valid", "invalid", "conflict", "unavailable", "error"]) });
const evidenceSummary = object({ items: array(profileEvidence, 8), total: count, omitted: count, truncated: Type.Boolean() });
const facets = object({ items: array(object({ field: label, values: array(Type.String({ maxLength: 120 }), 4), totalValues: count, omittedValues: count, shortenedValues: count, truncated: Type.Boolean() }), 8), total: count, omitted: count, truncated: Type.Boolean() });
const confidence = object({ items: array(object({ field: label, confidence: enumeration(["raw_exact", "profile_validated", "profile_warning"]), profiles: array(profileEvidence, 8), totalProfiles: count, omittedProfiles: count, profilesTruncated: Type.Boolean() }), 8), total: count, omitted: count, truncated: Type.Boolean() });
const kind = enumeration(["doc", "solution", "plan", "memory", "todo", "other-doc"]);
const related = object({ path: reference, kind, title: Type.Optional(description), relation: enumeration(["linksTo", "linkedFrom"]) });
const searchRow = object({ path: reference, kind, title: Type.Optional(description), score: Type.Number(), snippet: Type.Optional(Type.String({ maxLength: 1000 })), metadataFacets: facets, reasons: array(description, 6), profileValidation: evidenceSummary, filterSemantics: Type.Optional(confidence), related: Type.Optional(array(related, 20)) });
const canonical = object({ serviceId: label, packageName: label, packageVersion: label, contractVersion: Type.Literal(1) });
const provenance = object({ canonical, profiles: array(object({ profileId: label, packageName: label, packageVersion: label, contractVersion: Type.Literal(1), decision: enumeration(["applied", "not_applicable", "blocked"]) }), 8), profileSummary: object({ ...accounting, truncated: Type.Boolean() }), fallbacks: array(object({ code: label, action: enumeration(["used", "blocked", "not_needed"]), summary: description }), 8), executionGate: enumeration(["executed", "blocked"]) });
const cache = { cacheState: enumeration(["auto_fast_path", "memory_fast_path", "validated_unchanged", "rebuilt"]), freshnessMode: enumeration(["auto", "strict", "memory"]), refreshed: Type.Boolean(), fastPath: Type.Boolean() };
const field = object({ name: label, type: enumeration(["string", "string_list", "integer", "boolean", "date"]), indexed: Type.Boolean(), filterable: Type.Boolean(), required: Type.Boolean(), enumValues: array(description, 20), enumValuesTotal: count, enumValuesOmitted: count, owner: object({ kind: enumeration(["generic", "profile"]), profileId: Type.Optional(label), packageName: label, packageVersion: label }) });
const observedField = object({ name: label, documentCount: count, inferredPrimitiveTypes: Type.Optional(array(enumeration(["string", "number", "boolean", "null"]), 4)), distinctCount: Type.Optional(count), distinctCountCapped: Type.Optional(Type.Boolean()), sampleValues: Type.Optional(array(Type.String({ maxLength: 80 }), 3)) });
const todo = object({ issueId: Type.Integer({ minimum: 1 }), renderedId: Type.String({ pattern: "^[0-9]{3,}$", maxLength: 32 }), status: enumeration(["pending", "ready", "complete"]), priority: enumeration(["p1", "p2", "p3"]), path: reference, contentHash: hash });
const issue = object({ path: Type.Optional(reference), code: label, summary: description });
const recoveryEntry = object({ source: reference, target: reference, sourceHash: hash, targetHash: hash, journalState: enumeration(["prepared", "target_written", "source_removed"]), action: enumeration(["unknown", "removed_journal", "removed_source", "restored_source", "conflict"]), outcome: enumeration(["started", "completed", "failed"]), currentSourceHash: Type.Optional(Type.Union([hash, Type.Null()])), currentTargetHash: Type.Optional(Type.Union([hash, Type.Null()])) });
const unknownCount = Type.Union([count, Type.Null()]);
export const EFFECTS_SCHEMA_V1 = object({ phase: Type.String({ maxLength: 64 }), documentEffects: enumeration(["none", "possible", "observed", "unknown"]), cacheEffects: enumeration(["none", "possible", "observed", "unknown"]), recoveryStarted: unknownCount, recoveryCompleted: unknownCount, recoveryEntries: array(recoveryEntry, 2), recoveryEntriesOmitted: unknownCount, rollback: enumeration(["not_needed", "started", "completed", "failed", "unknown"]), references: array(reference, 8), referenceTotal: unknownCount, referencesOmitted: unknownCount, directoryHash: Type.Optional(hash) });
const completeness = object({ rows: object(accounting), issues: object(accounting), descriptionsClipped: count, sourceCoverage: enumeration(["preview_only", "scan_observation", "operation_observation", "field_catalog"]), bodyPreviewCharacters: Type.Optional(Type.Literal(1200)) });
const failure = { error: object({ code: Type.String({ maxLength: 64 }), message: description }), currentContentHash: Type.Optional(hash) };
const preconditions = object({ expectedContentHash: Type.Optional(hash), expectedDirectoryHash: Type.Optional(hash) });
function envelope(operation: string, data: TSchema): TSchema {
  const base = { schema: Type.Literal("@aefree/pi-project-artifacts/tool-output"), version: Type.Literal(1), operation: Type.Literal(operation), ...(operation.startsWith("project_todo_") ? { todoRootState: enumeration(["present", "missing", "unknown"]) } : {}), provenance: object({ projectorPackageName: label, projectorPackageVersion: label, producerObservation: enumeration(["canonical", "unavailable"]) }), effects: EFFECTS_SCHEMA_V1, preconditions: Type.Optional(preconditions) };
  return Type.Union([object({ ...base, ok: Type.Literal(true), data, completeness }), object({ ...base, ok: Type.Literal(false), ...failure })]);
}
export const TOOL_OUTPUT_SCHEMAS_V1: Readonly<Record<string, TSchema>> = Object.freeze({
  project_artifact_search: envelope("project_artifact_search", object({ ...cache, totalIndexedFiles: count, preparedResultCount: count, results: array(searchRow, 100), provenance, filtering: object({ exactNormalizedMatching: Type.Literal(true), schemaOpen: Type.Literal(true), knownProfileFieldCount: count }) })),
  project_artifact_describe: envelope("project_artifact_describe", object({ ...cache, outputMode: enumeration(["compact", "detailed"]), samplesIncluded: Type.Boolean(), fields: array(field, 100), fieldsTotal: count, fieldsOmitted: count, observedFields: array(observedField, 100), profileAvailability: array(object({ profileId: label, packageName: label, packageVersion: label, decision: enumeration(["applied", "not_applicable", "blocked"]) }), 8), profilesTotal: count, profilesOmitted: count })),
  project_todo_validate: envelope("project_todo_validate", object({ outcome: Type.Literal("listed"), todos: array(todo, 100), issues: array(issue, 100) })),
  project_todo_list: envelope("project_todo_list", object({ outcome: Type.Literal("listed"), todos: array(todo, 100), issues: array(issue, 100) })),
  project_todo_inspect: envelope("project_todo_inspect", object({ outcome: Type.Literal("inspected"), state: enumeration(["valid", "invalid", "conflict"]), todo: Type.Optional(todo), issues: array(issue, 100) })),
  project_todo_allocate: envelope("project_todo_allocate", object({ outcome: Type.Literal("allocated"), issueId: Type.Integer({ minimum: 1 }), renderedId: Type.String({ pattern: "^[0-9]{3,}$", maxLength: 32 }), directoryHash: hash, reservation: Type.Literal(false) })),
  project_todo_create: envelope("project_todo_create", object({ outcome: Type.Literal("created"), todo })),
  project_todo_transition: envelope("project_todo_transition", object({ outcome: Type.Literal("transitioned"), todo, previousPath: reference })),
});
