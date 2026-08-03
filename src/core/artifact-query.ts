import * as path from "node:path";
import type { ArtifactFieldDefinitionV1, ArtifactProfileV1, ArtifactSearchRequestV1 } from "../contracts/v1/index.js";
import type { ArtifactIndexEntryV1, ArtifactIndexV1, ArtifactKind, ProfileEntryData, SearchField } from "./artifact-index.js";
import { ProjectArtifactError } from "./errors.js";
import { stringValues } from "./markdown.js";

const DEFAULT_LIMIT = 20;
const DEFAULT_SNIPPET_CHARS = 220;
const PREPARED_LIMIT = 100;
const FIELD_WEIGHTS = Object.freeze({ title: 10, tags: 8, frontmatter: 6, headings: 4, path: 3, body: 1, phraseBonus: 5 });
const SEVERITY_BOOSTS: Readonly<Record<string, number>> = Object.freeze({ critical: 3, high: 2, medium: 1, low: 0.25 });
const TODO_STATUS_BOOSTS: Readonly<Record<string, number>> = Object.freeze({ ready: 3, pending: 2, complete: -0.5, blocked: -1 });
const TODO_PRIORITY_BOOSTS: Readonly<Record<string, number>> = Object.freeze({ p1: 3, p2: 1.5, p3: 0.5 });
const GENERIC_FIELDS: readonly ArtifactFieldDefinitionV1[] = Object.freeze([
  // These are generic Markdown fields, not todo-only schemas. Their values
  // remain unrestricted and exact-normalized filters work for arbitrary docs.
  { name: "status", type: "string", indexed: true, filterable: true },
  { name: "priority", type: "string", indexed: true, filterable: true },
  { name: "tags", type: "string_list", indexed: true, filterable: true },
  { name: "module", type: "string", indexed: true, filterable: true },
  { name: "component", type: "string", indexed: true, filterable: true },
  { name: "severity", type: "string", indexed: true, filterable: true },
]);
const SEARCH_FIELDS: readonly SearchField[] = ["path", "title", "tags", "frontmatter", "headings", "body"];
export const BODY_PREVIEW_SEARCH_CHARS = 1_200;
export type ArtifactFieldDescription = Readonly<{
  name: string;
  owner: Readonly<{ kind: "generic" | "profile"; profileId?: string; packageName: string; packageVersion: string }>;
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
export type RelatedArtifact = Readonly<{ path: string; kind: ArtifactKind; title?: string; relation: "linksTo" | "linkedFrom" }>;
export type ArtifactQueryResult = Readonly<{ results: readonly ArtifactSearchItem[]; totalMatches: number; preparedMatches: number; fieldDefinitions: readonly ArtifactFieldDescription[] }>;

export function describeArtifactFields(profiles: readonly ArtifactProfileV1[]): readonly ArtifactFieldDescription[] {
  const generic = GENERIC_FIELDS.map((field) => Object.freeze({
    ...field, required: field.required === true, enumValues: Object.freeze([...(field.enumValues ?? [])]),
    owner: Object.freeze({ kind: "generic" as const, packageName: "@aefree/pi-project-artifacts", packageVersion: "0.1.0" }),
  }));
  const profileFields = profiles.flatMap((profile) => profile.fields.map((field) => Object.freeze({
    ...field, required: field.required === true, enumValues: Object.freeze([...(field.enumValues ?? [])]),
    owner: Object.freeze({ kind: "profile" as const, profileId: profile.id, packageName: profile.owner.packageName, packageVersion: profile.owner.packageVersion }),
  })));
  return Object.freeze([...generic, ...profileFields].sort((left, right) => left.name.localeCompare(right.name) || left.owner.packageName.localeCompare(right.owner.packageName) || profileOwnerId(left).localeCompare(profileOwnerId(right))));
}
function profileOwnerId(field: ArtifactFieldDescription): string { return field.owner.kind === "profile" ? field.owner.profileId ?? "" : ""; }

export function searchArtifactIndex(index: ArtifactIndexV1, request: ArtifactSearchRequestV1, profiles: readonly ArtifactProfileV1[]): ArtifactQueryResult {
  const fieldDefinitions = describeArtifactFields(profiles);
  const filters = normalizeFilters(request.filters, fieldDefinitions);
  const queryTerms = tokenizeQuery(request.query);
  const requiredTerms = dedupe(normalizeList(request.requiredTerms));
  const optionalTerms = dedupe(normalizeList(request.optionalTerms));
  const terms = dedupe([...queryTerms, ...optionalTerms]);
  const scoringTerms = dedupe([...requiredTerms, ...terms]);
  const searchFields = fieldsForSearch(request);
  const mode = request.matchMode ?? "all";
  const minMatches = request.minTermMatches === undefined ? undefined : Math.max(1, Math.floor(request.minTermMatches));
  const scored: ArtifactSearchItem[] = [];
  for (const entry of Object.values(index.files)) {
    if (!passesScopes(entry, request.scopes ?? ["all"])) continue;
    if (!passesFilters(entry, filters, request.includeCompletedTodos)) continue;
    if (!matchesQuery(entry, terms, requiredTerms, mode, minMatches, searchFields)) continue;
    const { score, reasons } = scoreEntry(entry, request.query, scoringTerms, String(request.rankProfile ?? "balanced"), searchFields);
    if (score <= 0) continue;
    const titlePart = entry.title === undefined ? {} : { title: entry.title };
    scored.push(Object.freeze({ path: entry.path, kind: entry.kind, ...titlePart, score, frontmatter: entry.frontmatter, reasons: Object.freeze(reasons), profileValidation: entry.profileData }));
  }
  scored.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  const totalMatches = scored.length;
  const limit = Math.max(request.limit ?? DEFAULT_LIMIT, PREPARED_LIMIT);
  const maxSnippetChars = Math.max(60, Math.min(request.maxSnippetChars ?? DEFAULT_SNIPPET_CHARS, 1000));
  let prepared = scored.slice(0, limit).map((item) => {
    const entry = index.files[item.path]!;
    const snippet = makeSnippet(entry, scoringTerms, maxSnippetChars);
    return Object.freeze({ ...item, ...(snippet === undefined ? {} : { snippet }) });
  });
  if (request.includeRelated) prepared = attachRelated(prepared, index, request.relatedLimit);
  return Object.freeze({ results: Object.freeze(prepared), totalMatches, preparedMatches: prepared.length, fieldDefinitions });
}

export function formatArtifactResults(result: ArtifactQueryResult, request: ArtifactSearchRequestV1, metadata: { indexPath: string; refreshed: boolean; stats: { added: number; updated: number; removed: number; unchanged: number }; totalFiles: number }): string {
  const limit = Math.max(1, Math.min(request.limit ?? DEFAULT_LIMIT, 100));
  const shown = result.results.slice(0, limit);
  const detailed = request.outputMode === "detailed";
  const state = metadata.refreshed ? "refreshed" : "fresh";
  const changes = `+${metadata.stats.added}/~${metadata.stats.updated}/-${metadata.stats.removed}`;
  const indexSummary = detailed ? `Index: ${metadata.indexPath} (${state}; ${metadata.totalFiles} files, ${changes})` : `Index ${state}; files=${metadata.totalFiles}; changes=${changes}.`;
  const lines = [`${result.totalMatches} matching artifact${result.totalMatches === 1 ? "" : "s"}; showing ${shown.length}. ${indexSummary}`];
  if (fieldsForSearch(request).includes("body")) lines.push(`Body matching is preview-only: the first ${BODY_PREVIEW_SEARCH_CHARS} characters per Markdown body. For exhaustive body search, run the suggested rg command and read matching files directly.`);
  if (shown.length === 0) return lines.join("\n");
  lines.push("");
  const render = (item: ArtifactSearchItem, index: number) => {
    if (detailed) {
      lines.push(`${index + 1}. ${item.path}${item.title ? ` — ${item.title}` : ""}`);
      lines.push(`   kind: ${item.kind}; score: ${item.score.toFixed(1)}`);
      const summary = frontmatterSummary(item.frontmatter, false);
      if (summary) lines.push(`   ${summary}`);
      if (item.snippet) lines.push(`   snippet: ${item.snippet}`);
      if (request.explain && item.reasons.length > 0) lines.push(`   reasons: ${item.reasons.slice(0, 6).join("; ")}`);
      if (item.profileValidation.length > 0) lines.push(`   profile validation: ${item.profileValidation.map((profile) => `${profile.profileId}=${profile.validation.outcome}`).join("; ")}`);
      if (item.related?.length) lines.push(`   related: ${item.related.map((entry) => `${entry.path} (${entry.relation})`).join("; ")}`);
    } else {
      const summary = frontmatterSummary(item.frontmatter, true);
      lines.push(`${index + 1}. [${item.kind} ${item.score.toFixed(0)}] ${item.path}${item.title ? ` — ${item.title}` : ""}${summary ? ` | ${summary}` : ""}`);
      if (request.explain && item.reasons.length > 0) lines.push(`   why: ${item.reasons.slice(0, 4).join("; ")}`);
      if (item.related?.length) lines.push(`   related: ${item.related.map((entry) => `${entry.path} (${entry.relation})`).join("; ")}`);
    }
  };
  if (request.groupByKind) {
    let index = 0;
    for (const [kind, group] of Object.entries(groupByKind(shown))) {
      lines.push(`### ${kind}`);
      for (const item of group) render(item, index++);
    }
  } else shown.forEach(render);
  const suggestion = suggestedRg(request);
  if (suggestion) lines.push("", `${detailed ? "Suggested rg verification" : "Verify"}: ${suggestion}`);
  return lines.join("\n");
}

export function groupByKind(results: readonly ArtifactSearchItem[]): Readonly<Record<string, readonly ArtifactSearchItem[]>> {
  const groups: Record<string, ArtifactSearchItem[]> = {};
  for (const result of results) (groups[result.kind] ??= []).push(result);
  return Object.freeze(Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, Object.freeze(value)])));
}
export function suggestedRg(request: ArtifactSearchRequestV1): string | undefined {
  const terms = dedupe([...tokenizeQuery(request.query), ...normalizeList(request.requiredTerms), ...normalizeList(request.optionalTerms)]).slice(0, 12);
  if (terms.length === 0) return undefined;
  const expression = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|").replaceAll("'", "'\\''");
  return `rg -i --glob '*.md' '${expression}' "\${DOCS_ROOT}" "\${TODOS_ROOT}"`;
}
export function controlsFor(request: ArtifactSearchRequestV1, fieldDefinitions: readonly ArtifactFieldDescription[]): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ranking: Object.freeze({ rankProfile: request.rankProfile ?? "balanced", matchMode: request.matchMode ?? "all", minTermMatches: request.minTermMatches, requiredTerms: normalizeList(request.requiredTerms), optionalTerms: normalizeList(request.optionalTerms), includeBody: request.includeBody !== false, searchFields: fieldsForSearch(request), fieldWeights: FIELD_WEIGHTS, severityBoosts: SEVERITY_BOOSTS, todoStatusBoosts: TODO_STATUS_BOOSTS, todoPriorityBoosts: TODO_PRIORITY_BOOSTS }),
    bodySearchCoverage: Object.freeze({ mode: "preview_only", indexedCharactersPerDocument: BODY_PREVIEW_SEARCH_CHARS, exhaustiveSearch: "Use suggestedRg, then read each matching Markdown file; the index never searches body text beyond its preview." }),
    filters: Object.freeze({ exactNormalizedMatching: true, fields: fieldDefinitions.filter((field) => field.filterable) }),
    index: Object.freeze(["workspaceRoot", "docsRoot", "todosRoot", "indexPath", "rebuild", "freshnessMode", "freshnessTtlMs", "outputMode"]),
  });
}

type NormalizedFilter = Readonly<{ values: readonly string[]; owner: ArtifactFieldDescription["owner"] }>;

function normalizeFilters(filters: ArtifactSearchRequestV1["filters"], fieldDefinitions: readonly ArtifactFieldDescription[]): Record<string, NormalizedFilter> {
  const output: Record<string, NormalizedFilter> = {};
  const byName = new Map<string, ArtifactFieldDescription[]>();
  for (const field of fieldDefinitions) if (field.filterable) (byName.get(field.name) ?? (byName.set(field.name, []), byName.get(field.name)!)).push(field);
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/u.test(key)) throw new ProjectArtifactError("filter_invalid", `Invalid artifact filter field '${key}'.`);
    const definitions = byName.get(key);
    if (definitions === undefined) {
      throw new ProjectArtifactError("missing_profile", `No compatible artifact profile defines filter '${key}'.`, { field: key, expectedContractVersion: 1, remediation: "Install or enable the package that owns this artifact-profile field, then retry in a fresh session." });
    }
    if (definitions.length !== 1) {
      const owners = definitions.map((definition) => definition.owner.kind === "generic"
        ? "generic"
        : `profile '${definition.owner.profileId}' (${definition.owner.packageName})`);
      throw new ProjectArtifactError("filter_ambiguous", `Filter '${key}' is an unqualified field-name collision between ${owners.join(" and ")}; profile fields never merge with generic or other profile semantics.`, { field: key, definitions });
    }
    const definition = definitions[0]!;
    const values = stringValues(value).map((item) => validateFilterValue(key, item, definition)).filter(Boolean);
    if (values.length > 0) output[key] = Object.freeze({ values: Object.freeze([...new Set(values)]), owner: definition.owner });
  }
  return output;
}

function validateFilterValue(field: string, raw: string, definition: ArtifactFieldDescription): string {
  const value = normalizeSearchText(raw);
  if (!value) throw new ProjectArtifactError("filter_invalid", `Filter '${field}' must not be empty.`);
  const type = definition.type;
  const typeValid = type === "string" || type === "string_list"
    || type === "integer" && /^-?\d+$/u.test(raw.trim())
    || type === "boolean" && (value === "true" || value === "false")
    || type === "date" && isIsoDate(raw.trim());
  if (!typeValid) throw new ProjectArtifactError("filter_type_invalid", `Filter '${field}' requires a ${type} value; received '${raw}'.`, { field, type, value: raw });
  const enumValues = [...new Set(definition.enumValues.map(normalizeSearchText))];
  if (enumValues.length > 0 && !enumValues.includes(value)) {
    throw new ProjectArtifactError("filter_enum_invalid", `Filter '${field}' must be one of: ${enumValues.join(", ")}.`, { field, value: raw, enumValues });
  }
  return value;
}
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)); }
function normalizeList(value: string | readonly string[] | undefined): string[] { return stringValues(value).map((item) => normalizeSearchText(item)).filter(Boolean); }
function normalizeSearchText(value: string): string { return value.toLowerCase().replace(/[-_/]+/gu, " ").replace(/\s+/gu, " ").trim(); }
function tokenizeQuery(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return dedupe([...value.matchAll(/"([^"]+)"|'([^']+)'|([^\s]+)/gu)].map((match) => normalizeSearchText(match[1] ?? match[2] ?? match[3] ?? "")));
}
function dedupe(values: readonly string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function fieldsForSearch(request: ArtifactSearchRequestV1): SearchField[] {
  const requested = request.searchFields?.filter((field): field is SearchField => SEARCH_FIELDS.includes(field as SearchField));
  if (requested?.length) return [...new Set(requested)];
  return request.includeBody === false ? SEARCH_FIELDS.filter((field) => field !== "body") : [...SEARCH_FIELDS];
}
function passesScopes(entry: ArtifactIndexEntryV1, scopes: readonly string[]): boolean {
  if (scopes.length === 0 || scopes.includes("all")) return true;
  return scopes.some((scope) => scope === "docs" ? entry.root === "docs" : scope === "todos" ? entry.root === "todos" : scope === "solutions" ? entry.kind === "solution" : scope === "plans" ? entry.kind === "plan" : scope === "memories" ? entry.kind === "memory" : false);
}
function passesFilters(entry: ArtifactIndexEntryV1, filters: Readonly<Record<string, NormalizedFilter>>, includeCompleted: boolean | undefined): boolean {
  const status = statusFrom(entry);
  if (includeCompleted === false && entry.kind === "todo" && status === "complete" && filters.status === undefined) return false;
  for (const [field, filter] of Object.entries(filters)) {
    // A profile-owned field is meaningful only for entries to which that exact
    // profile applied. Raw frontmatter cannot impersonate profile ownership.
    if (filter.owner.kind === "profile" && !entry.profileData.some((profile) => profile.profileId === filter.owner.profileId
      && profile.packageName === filter.owner.packageName && profile.packageVersion === filter.owner.packageVersion)) return false;
    const actual = filter.owner.kind === "generic" && field === "status" ? status === undefined ? [] : [status]
      : filter.owner.kind === "generic" && field === "priority" ? priorityFrom(entry) === undefined ? [] : [priorityFrom(entry)!]
      : stringValues(entry.frontmatter[field]).map(normalizeSearchText);
    if (!filter.values.some((needle) => actual.some((value) => value === needle))) return false;
  }
  return true;
}
function statusFrom(entry: ArtifactIndexEntryV1): string | undefined {
  const status = stringValues(entry.frontmatter.status)[0]?.toLowerCase();
  const raw = status ?? /^(?:\d+)-([a-z]+)-/u.exec(path.basename(entry.path).toLowerCase())?.[1];
  return raw === "completed" ? "complete" : raw;
}
function priorityFrom(entry: ArtifactIndexEntryV1): string | undefined { return stringValues(entry.frontmatter.priority)[0]?.toLowerCase() ?? /^\d+-[a-z]+-(p\d)-/u.exec(path.basename(entry.path).toLowerCase())?.[1]; }
function matchesQuery(entry: ArtifactIndexEntryV1, terms: readonly string[], required: readonly string[], mode: ArtifactSearchRequestV1["matchMode"], minMatches: number | undefined, fields: readonly SearchField[]): boolean {
  const haystack = fields.map((field) => fieldText(entry, field)).map(normalizeSearchText).join(" ");
  if (required.some((term) => !haystack.includes(term))) return false;
  if (terms.length === 0) return true;
  if (mode === "phrase") return haystack.includes(terms.join(" "));
  const count = terms.filter((term) => haystack.includes(term)).length;
  if (minMatches !== undefined) return count >= Math.min(minMatches, terms.length);
  return mode === "any" ? count > 0 : count === terms.length;
}
function fieldText(entry: ArtifactIndexEntryV1, field: SearchField): string {
  switch (field) {
    case "path": return aliasText([entry.path]);
    case "title": return aliasText([entry.title ?? ""]);
    case "tags": return aliasText(stringValues(entry.frontmatter.tags));
    case "frontmatter": return aliasText(Object.entries(entry.frontmatter).flatMap(([key, value]) => [key, ...stringValues(value)]));
    case "headings": return aliasText([...entry.headings]);
    case "body": return entry.bodyPreview;
  }
}
function aliasText(values: readonly string[]): string { return values.flatMap((value) => [value, value.replace(/([a-z0-9])([A-Z])/gu, "$1 $2"), value.replace(/[-_/]+/gu, " "), value.replace(/[-_/\s]+/gu, "")]).join(" "); }
function scoreEntry(entry: ArtifactIndexEntryV1, query: string | undefined, terms: readonly string[], profile: string, fields: readonly SearchField[]): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const field of fields) {
    const text = normalizeSearchText(fieldText(entry, field));
    const matches = terms.filter((term) => text.includes(term));
    if (matches.length === 0) continue;
    let multiplier = 1;
    if (profile === "frontmatter") multiplier = field === "body" ? 0.25 : ["tags", "title", "frontmatter"].includes(field) ? 1.6 : 1;
    if (profile === "todos") multiplier = field === "body" ? 0.5 : ["title", "frontmatter"].includes(field) ? 1.3 : 1;
    const fieldScore = FIELD_WEIGHTS[field] * multiplier * matches.length;
    score += fieldScore;
    reasons.push(`${field} matched ${matches.join(", ")} (+${fieldScore.toFixed(1)})`);
  }
  const phrase = query ? normalizeSearchText(query) : "";
  if (phrase.includes(" ") && fields.some((field) => normalizeSearchText(fieldText(entry, field)).includes(phrase))) { score += FIELD_WEIGHTS.phraseBonus; reasons.push(`exact phrase (+${FIELD_WEIGHTS.phraseBonus})`); }
  const severity = stringValues(entry.frontmatter.severity)[0]?.toLowerCase();
  if (severity && (SEVERITY_BOOSTS[severity] ?? 0) !== 0) { score += SEVERITY_BOOSTS[severity]!; reasons.push(`${severity} severity boost (+${SEVERITY_BOOSTS[severity]})`); }
  if (entry.kind === "todo") {
    const multiplier = profile === "todos" ? 1.5 : 1;
    const status = statusFrom(entry), priority = priorityFrom(entry);
    if (status && TODO_STATUS_BOOSTS[status]) { const value = TODO_STATUS_BOOSTS[status]! * multiplier; score += value; reasons.push(`${status} todo status boost (${value >= 0 ? "+" : ""}${value.toFixed(1)})`); }
    if (priority && TODO_PRIORITY_BOOSTS[priority]) { const value = TODO_PRIORITY_BOOSTS[priority]! * multiplier; score += value; reasons.push(`${priority} todo priority boost (+${value.toFixed(1)})`); }
  }
  if (profile === "recency") { const ageDays = Math.max(0, (Date.now() - entry.mtimeMs) / 86_400_000); const value = Math.max(0, 3 - Math.log10(ageDays + 1)); score += value; reasons.push(`recency boost (+${value.toFixed(1)})`); }
  if (terms.length === 0 && score === 0) score = 1;
  return { score, reasons };
}
function makeSnippet(entry: ArtifactIndexEntryV1, terms: readonly string[], maxChars: number): string | undefined {
  if (terms.length === 0) return undefined;
  const source = entry.bodyPreview || entry.headings.join("\n") || entry.title || entry.path;
  const lower = normalizeSearchText(source);
  const hit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((left, right) => left - right)[0];
  if (hit === undefined) return undefined;
  const start = Math.max(0, hit - Math.floor(maxChars / 3));
  const end = Math.min(source.length, start + maxChars);
  return `${start > 0 ? "…" : ""}${source.slice(start, end).replace(/\s+/gu, " ").trim()}${end < source.length ? "…" : ""}`;
}
function attachRelated(results: readonly ArtifactSearchItem[], index: ArtifactIndexV1, rawLimit: number | undefined): ArtifactSearchItem[] {
  const limit = Math.max(0, Math.min(rawLimit ?? 5, 20));
  const backlinks = new Map<string, ArtifactIndexEntryV1[]>();
  for (const entry of Object.values(index.files)) for (const link of entry.linksTo) if (index.files[link]) (backlinks.get(link) ?? (backlinks.set(link, []), backlinks.get(link)!)).push(entry);
  return results.map((item) => {
    const entry = index.files[item.path]!;
    const related: RelatedArtifact[] = [];
    const seen = new Set<string>();
    const add = (candidate: ArtifactIndexEntryV1 | undefined, relation: RelatedArtifact["relation"]) => {
      if (!candidate || candidate.path === item.path || seen.has(candidate.path) || related.length >= limit) return;
      seen.add(candidate.path);
      related.push(Object.freeze({ path: candidate.path, kind: candidate.kind, ...(candidate.title === undefined ? {} : { title: candidate.title }), relation }));
    };
    for (const link of entry.linksTo) add(index.files[link], "linksTo");
    for (const backlink of backlinks.get(entry.path) ?? []) add(backlink, "linkedFrom");
    return Object.freeze({ ...item, ...(related.length === 0 ? {} : { related: Object.freeze(related) }) });
  });
}
function frontmatterSummary(frontmatter: Readonly<Record<string, unknown>>, compact: boolean): string {
  const fields = compact ? [["status", "status"], ["priority", "prio"], ["severity", "sev"], ["module", "mod"], ["component", "comp"], ["tags", "tags"]] : [["status", "status"], ["priority", "priority"], ["module", "module"], ["component", "component"], ["severity", "severity"], ["tags", "tags"]];
  return fields.flatMap(([field, label]) => { const values = stringValues(frontmatter[field!]); return values.length ? [`${label}=${values.slice(0, 5).join(", ")}${values.length > 5 ? `, +${values.length - 5}` : ""}`] : []; }).join("; ");
}
