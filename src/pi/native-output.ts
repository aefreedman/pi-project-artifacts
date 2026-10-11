import { ARTIFACTS_PACKAGE_NAME, ARTIFACTS_PACKAGE_VERSION } from "../core/package-identity.js";
import { Check } from "typebox/value";
import type { TSchema } from "typebox";
import { TOOL_OUTPUT_SCHEMAS_V1, NATIVE_OUTPUT_BYTES_V1, PRESENTATION_BYTES_V1, DETAILS_BYTES_V1 } from "../contracts/v1/tool-output.js";
import { assertTodoLifecycleResultV1 } from "../contracts/v1/index.js";
import { operationObservations } from "../core/operation-observations.js";
import { errorCode } from "../core/errors.js";

type RecordValue = Record<string, any>;
type SampleDisclosure = { samples: boolean; fieldNames: readonly string[] };
export type NativeExecution = { native: unknown; text: string; details: RecordValue };
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native record");
  return value as RecordValue;
};
const rows = (value: unknown): any[] => { if (!Array.isArray(value)) throw new Error("Invalid native rows"); return value; };
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
const count = (total: number, returned: number) => {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(returned) || total < returned || returned < 0) throw new Error("Invalid native accounting");
  return { total, returned, omitted: total - returned };
};
function exact(value: unknown, maximum = 4096, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.length) || value.length > maximum || value.includes("\0")) throw new Error("Unpublishable native identity");
  return value;
}
function optional<T>(key: string, value: T | undefined) { return value === undefined ? {} : { [key]: value }; }
function effects(native: unknown, conservative = false) {
  const observation = operationObservations(native);
  const admitted = observation?.references ?? [];
  // A projection failure may withhold inadmissible references, never substitute them.
  const references = conservative ? admitted.filter(value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0")) : admitted.map(value => exact(value));
  const recoveryEntries = (observation?.recoveryEntries ?? []).filter(entry => !conservative || [entry.source, entry.target].every(value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0"))).map(entry => ({ source: exact(entry.source), target: exact(entry.target), sourceHash: exact(entry.sourceHash, 71), targetHash: exact(entry.targetHash, 71), journalState: entry.journalState, action: entry.action, outcome: entry.outcome, ...optional("currentSourceHash", entry.currentSourceHash), ...optional("currentTargetHash", entry.currentTargetHash) }));
  return observation ? {
    phase: observation.phase,
    documentEffects: conservative && references.length !== admitted.length && observation.documentEffects !== "none" ? "possible" : observation.documentEffects,
    cacheEffects: observation.cacheEffects,
    recoveryStarted: observation.recoveryStarted, recoveryCompleted: observation.recoveryCompleted, recoveryEntries, recoveryEntriesOmitted: observation.recoveryStarted - recoveryEntries.length,
    rollback: observation.rollback, references, referenceTotal: observation.referenceTotal,
    referencesOmitted: observation.referenceTotal - references.length,
    ...optional("directoryHash", observation.directoryHash),
  } : { phase: "provider_observation_unavailable", documentEffects: "unknown", cacheEffects: "unknown", recoveryStarted: null, recoveryCompleted: null, recoveryEntries: [], recoveryEntriesOmitted: null, rollback: "unknown", references: [], referenceTotal: null, referencesOmitted: null };
}
function base(name: string, native: unknown, preconditions?: RecordValue, conservative = false) {
  return { schema: "@aefree/pi-project-artifacts/tool-output", version: 1, operation: name, ...(name.startsWith("project_todo_") ? { todoRootState: operationObservations(native)?.todoRootState ?? "unknown" } : {}), provenance: { projectorPackageName: ARTIFACTS_PACKAGE_NAME, projectorPackageVersion: ARTIFACTS_PACKAGE_VERSION, producerObservation: operationObservations(native) === undefined ? "unavailable" : "canonical" }, effects: effects(native, conservative), ...(preconditions && Object.keys(preconditions).length ? { preconditions } : {}) };
}
function failure(name: string, native: unknown, code: string, preconditions?: RecordValue, projection = false) {
  const safeCode = /^[a-z][a-z0-9_.-]{0,63}$/u.test(code) ? code : "operation_failed";
  const currentContentHash = recordOrEmpty(native).currentContentHash;
  const result = {
    ...base(name, native, preconditions, true), ok: false,
    error: { code: safeCode, message: projection ? "Native output could not be safely projected. Work was not replayed; inspect effects before reconciliation." : `Operation did not complete (${safeCode}). Inspect effects before reconciliation; do not replay automatically.` },
    ...(typeof currentContentHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(currentContentHash) ? { currentContentHash } : {}),
  };
  // Byte overflow with fixed mutation evidence withholds whole references, never repairs or replays work.
  while (bytes(result) > NATIVE_OUTPUT_BYTES_V1 && result.effects.recoveryEntries.length) {
    result.effects.recoveryEntries.pop();
    if (result.effects.recoveryEntriesOmitted !== null) result.effects.recoveryEntriesOmitted++;
  }
  while (bytes(result) > NATIVE_OUTPUT_BYTES_V1 && result.effects.references.length) {
    result.effects.references.pop();
    if (result.effects.referencesOmitted !== null) result.effects.referencesOmitted++;
    if (result.effects.documentEffects !== "none" && result.effects.documentEffects !== "unknown") result.effects.documentEffects = "possible";
  }
  return result;
}
const recordOrEmpty = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
function checked(name: string, value: RecordValue) {
  const schema = TOOL_OUTPUT_SCHEMAS_V1[name] as TSchema;
  if (!schema || !Check(schema, value) || bytes(value) > NATIVE_OUTPUT_BYTES_V1) throw new Error("Native output contract failure");
  return value;
}

/** Single canonical execution, then allowlisted validation. Hooks remain Pi-owned. */
export async function nativeToolResult(name: string, execute: () => Promise<NativeExecution>, preconditions?: RecordValue, disclosure?: SampleDisclosure) {
  let execution: NativeExecution;
  try { execution = await execute(); }
  catch (error) {
    const dto = checked(name, failure(name, error, errorCode(error) ?? "operation_failed", preconditions));
    return { content: [{ type: "text" as const, text: errorPresentation(dto) }], details: {}, structuredContent: dto, isError: true };
  }
  let dto: RecordValue;
  try { dto = checked(name, project(name, execution.native, preconditions, disclosure)); }
  catch {
    dto = checked(name, failure(name, execution.native, "output_contract_error", preconditions, true));
    return { content: [{ type: "text" as const, text: errorPresentation(dto) }], details: {}, structuredContent: dto, isError: true };
  }
  try {
    const details = bytes(execution.details) <= DETAILS_BYTES_V1 ? execution.details : rendererSummary(execution.details, dto);
    const receipt = receiptText(dto);
    const presentationBudget = PRESENTATION_BYTES_V1 - Buffer.byteLength(receipt, "utf8");
    let text = execution.text;
    if (Buffer.byteLength(text, "utf8") > presentationBudget) {
      // Complete rows only: never cut an actionable reference halfway through.
      text = `${name}: ${dto.ok ? "completed observation" : dto.error.code}. Presentation shortened; inspect native completeness/effects.\n`;
      const items = dto.data?.results ?? dto.data?.todos ?? dto.data?.observedFields ?? dto.data?.issues ?? [];
      let emitted = 0;
      for (const item of items) {
        const line = JSON.stringify(item) + "\n";
        if (Buffer.byteLength(text + line, "utf8") > presentationBudget - 1024) break;
        text += line; emitted++;
      }
      text += `Presentation rows returned=${emitted}; omitted=${items.length - emitted}.\n`;
      if (dto.completeness) text += JSON.stringify(dto.completeness);
    }
    return { content: [{ type: "text" as const, text }, { type: "text" as const, text: receipt }], details, structuredContent: dto, ...(dto.ok ? {} : { isError: true }) };
  } catch {
    const failed = checked(name, failure(name, execution.native, "output_contract_error", preconditions, true));
    return { content: [{ type: "text" as const, text: errorPresentation(failed) }], details: {}, structuredContent: failed, isError: true };
  }
}
function receiptText(dto: RecordValue): string {
  const effect = dto.effects;
  const coverage = dto.completeness;
  const projection = coverage ? `Native projection: rows ${coverage.rows.returned}/${coverage.rows.total}, omitted=${coverage.rows.omitted}; issues ${coverage.issues.returned}/${coverage.issues.total}, omitted=${coverage.issues.omitted}; descriptionsClipped=${coverage.descriptionsClipped}.\n` : "";
  return projection + (dto.todoRootState ? `Todo root: ${dto.todoRootState}. ` : "") + `Effects: phase=${effect.phase}; documents=${effect.documentEffects}; cache/coordination=${effect.cacheEffects}; recovery=${effect.recoveryCompleted ?? "unknown"}/${effect.recoveryStarted ?? "unknown"}; rollback=${effect.rollback}; referencesOmitted=${effect.referencesOmitted ?? "unknown"}.` + (dto.currentContentHash ? `\nCurrent content hash: ${dto.currentContentHash}` : "") + (effect.directoryHash ? `\nObserved directory hash: ${effect.directoryHash}` : "");
}
function errorPresentation(dto: RecordValue): string { return dto.error.message + "\n" + receiptText(dto); }

function rendererSummary(details: RecordValue, dto: RecordValue) {
  const result = recordOrEmpty(details.result);
  const catalog = recordOrEmpty(details.observedFieldCatalog);
  return {
    presentationDetailsOmitted: true,
    resultCount: dto.completeness?.rows.total, returnedResultCount: dto.completeness?.rows.returned,
    cacheState: dto.data?.cacheState,
    fields: [], fieldDefinitionCount: Array.isArray(details.fields) ? details.fields.length : 0,
    observedFieldCatalog: { fields: [], totalFieldCount: Number.isSafeInteger(catalog.totalFieldCount) ? catalog.totalFieldCount : 0 },
    result: { outcome: dto.data?.outcome ?? "blocked", summary: "Oversized details omitted; see bounded content/native completeness.", todo: dto.data?.todo, renderedId: dto.data?.renderedId, todos: [], issues: [], todosTotal: Array.isArray(result.todos) ? result.todos.length : 0, issuesTotal: Array.isArray(result.issues) ? result.issues.length : 0 },
  };
}

function project(name: string, native: unknown, preconditions?: RecordValue, disclosure?: SampleDisclosure): RecordValue {
  let clipped = 0;
  const text = (value: unknown, max = 240): string => {
    if (typeof value !== "string") throw new Error("Invalid native text");
    if (value.length > max) clipped++;
    return value.slice(0, max);
  };
  const evidence = (value: unknown) => {
    const source = record(value);
    return { items: rows(source.items).slice(0, 8).map(item => ({ profileId: exact(item.profileId, 256), outcome: item.outcome })), total: source.total, omitted: source.omitted, truncated: source.truncated };
  };
  const todo = (value: unknown) => {
    const source = record(value);
    return { issueId: source.issueId, renderedId: exact(source.renderedId, 32), status: source.status, priority: source.priority, path: exact(source.path), contentHash: exact(source.contentHash, 71) };
  };
  const issue = (value: unknown) => {
    const source = record(value);
    return { ...optional("path", source.path === undefined ? undefined : exact(source.path)), code: exact(source.code, 256), summary: text(source.summary) };
  };
  let data: RecordValue;
  let rowTotal = 0, rowReturned = 0, issueTotal = 0, issueReturned = 0;
  let sourceCoverage = "operation_observation";
  if (name === "project_artifact_search") {
    const result = record(native), source = record(result.details), provenance = record(result.provenance);
    const items = rows(source.results).slice(0, 100).map(item => {
      const facets = record(item.metadataFacets);
      const semantics = item.filterSemantics === undefined ? undefined : record(item.filterSemantics);
      return {
        path: exact(item.path), kind: item.kind, ...optional("title", item.title === undefined ? undefined : text(item.title)), score: item.score,
        ...optional("snippet", item.snippet === undefined ? undefined : text(item.snippet, 1000)), reasons: rows(item.reasons).slice(0, 6).map(reason => text(reason)),
        metadataFacets: { items: rows(facets.items).slice(0, 8).map(facet => ({ field: exact(facet.field, 256), values: rows(facet.values).map(value => text(value, 120)), totalValues: facet.totalValues, omittedValues: facet.omittedValues, shortenedValues: facet.shortenedValues, truncated: facet.truncated })), total: facets.total, omitted: facets.omitted, truncated: facets.truncated },
        profileValidation: evidence(item.profileValidation),
        ...(semantics === undefined ? {} : { filterSemantics: { items: rows(semantics.items).slice(0, 8).map(field => ({ field: exact(field.field, 256), confidence: field.confidence, profiles: rows(field.profiles).slice(0, 8).map(profile => ({ profileId: exact(profile.profileId, 256), outcome: profile.outcome })), totalProfiles: field.totalProfiles, omittedProfiles: field.omittedProfiles, profilesTruncated: field.profilesTruncated })), total: semantics.total, omitted: semantics.omitted, truncated: semantics.truncated } }),
        ...(item.related === undefined ? {} : { related: rows(item.related).slice(0, 20).map(row => ({ path: exact(row.path), kind: row.kind, ...optional("title", row.title === undefined ? undefined : text(row.title)), relation: row.relation })) }),
      };
    });
    rowTotal = source.resultCount; rowReturned = items.length; sourceCoverage = "preview_only";
    const profiles = rows(provenance.profiles).slice(0, 8).map(profile => ({ profileId: exact(profile.profileId, 256), packageName: exact(profile.packageName, 256), packageVersion: exact(profile.packageVersion, 256), contractVersion: profile.contractVersion, decision: profile.decision }));
    const owner = record(provenance.canonical);
    data = { ...cache(source), totalIndexedFiles: source.totalIndexedFiles, preparedResultCount: source.preparedResultCount, results: items, filtering: { exactNormalizedMatching: source.filtering?.exactNormalizedMatching, schemaOpen: source.filtering?.schemaOpen, knownProfileFieldCount: source.filtering?.knownProfileFieldCount }, provenance: { canonical: { serviceId: exact(owner.serviceId, 256), packageName: exact(owner.packageName, 256), packageVersion: exact(owner.packageVersion, 256), contractVersion: owner.contractVersion }, profiles, profileSummary: provenance.profileSummary ?? { ...count(rows(provenance.profiles).length, profiles.length), truncated: rows(provenance.profiles).length > profiles.length }, fallbacks: rows(provenance.fallbacks).slice(0, 8).map(row => ({ code: exact(row.code, 256), action: row.action, summary: text(row.summary) })), executionGate: provenance.executionGate } };
  } else if (name === "project_artifact_describe") {
    const source = record(native), catalog = record(source.observedFieldCatalog);
    const fields = rows(source.fields).slice(0, 100).map(field => ({ name: exact(field.name, 256), type: field.type, indexed: field.indexed, filterable: field.filterable, required: field.required, enumValues: rows(field.enumValues).slice(0, 20).map(value => exact(value, 240, true)), enumValuesTotal: rows(field.enumValues).length, enumValuesOmitted: Math.max(0, rows(field.enumValues).length - 20), owner: { kind: field.owner.kind, ...optional("profileId", field.owner.profileId === undefined ? undefined : exact(field.owner.profileId, 256)), packageName: exact(field.owner.packageName, 256), packageVersion: exact(field.owner.packageVersion, 256) } }));
    const observedFields = rows(catalog.fields).slice(0, 100).map(field => ({ name: exact(field.name, 256), documentCount: field.documentCount, ...optional("inferredPrimitiveTypes", field.inferredPrimitiveTypes), ...optional("distinctCount", field.distinctCount), ...optional("distinctCountCapped", field.distinctCountCapped), ...(disclosure?.samples === true && disclosure.fieldNames.includes(field.name) && source.samplesIncluded === true && source.outputMode === "detailed" && field.sampleValues !== undefined ? { sampleValues: rows(field.sampleValues).slice(0, 3).map(value => text(value, 80)) } : {}) }));
    const profiles = rows(source.profileAvailability);
    data = { ...cache(source), outputMode: source.outputMode, samplesIncluded: disclosure?.samples === true && source.samplesIncluded === true, fields, fieldsTotal: rows(source.fields).length, fieldsOmitted: rows(source.fields).length - fields.length, observedFields, profileAvailability: profiles.slice(0, 8).map(profile => ({ profileId: exact(profile.profileId, 256), packageName: exact(profile.packageName, 256), packageVersion: exact(profile.packageVersion, 256), decision: profile.decision })), profilesTotal: profiles.length, profilesOmitted: Math.max(0, profiles.length - 8) };
    rowTotal = catalog.totalFieldCount; rowReturned = observedFields.length; sourceCoverage = "field_catalog";
  } else {
    assertTodoLifecycleResultV1(native);
    const source = record(native);
    if (source.outcome === "blocked" || source.outcome === "conflict") return failure(name, native, source.code, preconditions);
    data = { outcome: source.outcome };
    if (source.outcome === "listed") {
      data.todos = rows(source.todos).slice(0, 100).map(todo); data.issues = rows(source.issues).slice(0, 100).map(issue);
      rowTotal = source.todos.length; rowReturned = data.todos.length; issueTotal = source.issues.length; issueReturned = data.issues.length; sourceCoverage = "scan_observation";
    } else if (source.outcome === "inspected") {
      data.state = source.state; if (source.todo !== undefined) data.todo = todo(source.todo);
      data.issues = rows(source.issues).slice(0, 100).map(issue); issueTotal = source.issues.length; issueReturned = data.issues.length; rowTotal = rowReturned = source.todo === undefined ? 0 : 1; sourceCoverage = "scan_observation";
    } else if (source.outcome === "allocated") {
      Object.assign(data, { issueId: source.issueId, renderedId: exact(source.renderedId, 32), directoryHash: exact(source.directoryHash, 71), reservation: false }); rowTotal = rowReturned = 1;
    } else {
      data.todo = todo(source.todo); rowTotal = rowReturned = 1;
      if (source.outcome === "transitioned") data.previousPath = exact(source.previousPath);
    }
  }
  return { ...base(name, native, preconditions), ok: true, data, completeness: { rows: count(rowTotal, rowReturned), issues: count(issueTotal, issueReturned), descriptionsClipped: clipped, sourceCoverage, ...(sourceCoverage === "preview_only" ? { bodyPreviewCharacters: 1200 } : {}) } };
}
function cache(source: RecordValue) { return { cacheState: source.cacheState, freshnessMode: source.freshnessMode, refreshed: source.refreshed, fastPath: source.fastPath }; }
