import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { assertArtifactValidationResultV1 } from "../contracts/v1/index.js";
import { cleanupOwnedOrphanTemps, withDirectoryLock, withMutationQueue, writeJsonAtomic } from "./atomic.js";
import { ProjectArtifactError, throwIfAborted } from "./errors.js";
import { extractArtifactLinks, extractHeadings, extractTitle, parseMarkdown, stringValues } from "./markdown.js";
import { assertPhysicalContainment, collisionKey, isPathInside, normalizeForIdentity, normalizePath, physicalDirectory, resolveArtifactRoots, scopedPhysicalDirectory, scopedPhysicalDirectoryOrMissing } from "./roots.js";
export const ARTIFACT_INDEX_SCHEMA = "@aefree/pi-project-artifacts/index";
export const ARTIFACT_INDEX_VERSION = 1;
const BODY_PREVIEW_CHARS = 1_200;
const DEFAULT_FRESHNESS_TTL_MS = 30_000;
export function artifactCacheState(refresh) {
    if (refresh.fastPath)
        return refresh.freshnessMode === "memory" ? "memory_fast_path" : "auto_fast_path";
    return refresh.refreshed ? "rebuilt" : "validated_unchanged";
}
const memoryCache = new Map();
const dirtyIndexes = new Set();
const activeRoots = new Map();
export function defaultIndexFilename(roots) {
    const defaultDocs = path.resolve(roots.workspaceRoot, "docs");
    const defaultTodos = path.resolve(roots.workspaceRoot, "todos");
    if (normalizeForIdentity(roots.docsRoot) === normalizeForIdentity(defaultDocs)
        && normalizeForIdentity(roots.todosRoot) === normalizeForIdentity(defaultTodos))
        return "index-v1.json";
    const hash = createHash("sha256").update([roots.workspaceRoot, roots.docsRoot, roots.todosRoot].map(normalizeForIdentity).join("\n")).digest("hex").slice(0, 10);
    const docsParent = path.dirname(roots.docsRoot);
    const todosParent = path.dirname(roots.todosRoot);
    const rawLabel = normalizeForIdentity(docsParent) === normalizeForIdentity(todosParent) ? path.basename(docsParent) : "custom-roots";
    const label = rawLabel.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").toLowerCase() || "custom-roots";
    return `index-v1-${label}-${hash}.json`;
}
export function resolveIndexPath(request, roots) {
    const raw = request.indexPath?.trim().replace(/^@(?=[^@])/u, "");
    const indexPath = raw
        ? path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(roots.workspaceRoot, raw)
        : path.join(roots.workspaceRoot, ".pi-project-artifacts", defaultIndexFilename(roots));
    if (!isPathInside(roots.workspaceRoot, indexPath))
        throw new ProjectArtifactError("index_path_escape", "indexPath must stay inside workspaceRoot.", { indexPath: normalizePath(indexPath) });
    if (isPathInside(roots.docsRoot, indexPath) || isPathInside(roots.todosRoot, indexPath)) {
        throw new ProjectArtifactError("index_path_authoritative", "indexPath must not overlap authoritative docs or todos roots.", { indexPath: normalizePath(indexPath) });
    }
    return indexPath;
}
/** Resolve a requested workspace within the physical session boundary without indexing it. */
export async function resolveContainedWorkspaceRoot(context, request = {}) {
    throwIfAborted(context.signal);
    const physicalExecutionRoot = await physicalDirectory(path.resolve(context.cwd));
    const lexicalRoots = resolveArtifactRoots(context.cwd, request);
    return await scopedPhysicalDirectory(physicalExecutionRoot, lexicalRoots.workspaceRoot, "workspaceRoot");
}
export async function buildOrRefreshIndex(request, context, profiles = [], failureInjector) {
    throwIfAborted(context.signal);
    const physicalExecutionRoot = await physicalDirectory(path.resolve(context.cwd));
    const lexicalRoots = resolveArtifactRoots(context.cwd, request);
    const workspaceRoot = await scopedPhysicalDirectory(physicalExecutionRoot, lexicalRoots.workspaceRoot, "workspaceRoot");
    const docsRoot = await scopedPhysicalDirectoryOrMissing(physicalExecutionRoot, lexicalRoots.docsRoot, "docsRoot");
    const todosRoot = await scopedPhysicalDirectoryOrMissing(physicalExecutionRoot, lexicalRoots.todosRoot, "todosRoot");
    const roots = Object.freeze({
        workspaceRoot,
        docsRoot,
        todosRoot,
        rootIdentity: rootIdentity(workspaceRoot, docsRoot, todosRoot),
    });
    const indexPath = resolveIndexPath(request, roots);
    await assertPhysicalContainment(workspaceRoot, indexPath, "indexPath");
    activeRoots.set(cacheKey(indexPath), { docsRoot: roots.docsRoot, todosRoot: roots.todosRoot });
    const mode = request.freshnessMode ?? "auto";
    const ttlMs = Math.max(0, Math.floor(request.freshnessTtlMs ?? DEFAULT_FRESHNESS_TTL_MS));
    if (!request.rebuild && mode !== "strict") {
        const existing = await loadCanonicalIndex(indexPath);
        const cached = memoryCache.get(cacheKey(indexPath));
        if (existing !== undefined && rootsMatch(existing, roots) && profilesMatch(existing, profiles)
            && mode === "memory" || (existing !== undefined && rootsMatch(existing, roots) && profilesMatch(existing, profiles)
            && cached?.index === existing && !dirtyIndexes.has(cacheKey(indexPath)) && Date.now() - cached.validatedAtMs <= ttlMs && !await exists(`${indexPath}.lock`))) {
            return Object.freeze({ index: existing, indexPath, refreshed: false, fastPath: true, freshnessMode: mode, stats: emptyStats(), orphanTempsRemoved: Object.freeze([]) });
        }
    }
    return await withMutationQueue(indexPath, async () => {
        const lockPath = `${indexPath}.lock`;
        await assertPhysicalContainment(workspaceRoot, lockPath, "index lock path");
        return await withDirectoryLock(lockPath, lockOwner(indexPath, roots.rootIdentity), async () => {
            await assertPhysicalContainment(workspaceRoot, indexPath, "indexPath");
            const orphanTempsRemoved = await cleanupOwnedOrphanTemps(indexPath);
            return await refreshLocked(request, context, roots, indexPath, mode, profiles, orphanTempsRemoved, failureInjector);
        }, { signal: context.signal, physicalRoot: workspaceRoot });
    });
}
async function refreshLocked(request, context, roots, indexPath, mode, profiles, orphanTempsRemoved, failureInjector) {
    throwIfAborted(context.signal);
    const ownership = await inspectIndexOwnership(indexPath);
    if (ownership.kind === "occupied")
        throw new ProjectArtifactError("index_path_occupied", `indexPath is occupied by an unrelated or malformed file: ${normalizePath(indexPath)}`, { indexPath: normalizePath(indexPath), reason: ownership.reason });
    const loaded = ownership.kind === "canonical" ? ownership.index : undefined;
    const existing = !request.rebuild && loaded !== undefined && rootsMatch(loaded, roots) && profilesMatch(loaded, profiles) ? loaded : undefined;
    const current = new Map();
    for (const [rootPath, rootName] of [[roots.docsRoot, "docs"], [roots.todosRoot, "todos"]]) {
        for (const file of await listMarkdownFiles(rootPath, context.signal)) {
            const stats = await stat(file);
            const relative = normalizePath(path.join(rootName, path.relative(rootPath, file)));
            const bytes = await readFile(file);
            current.set(relative, { absolute: file, rootPath, root: rootName, mtimeMs: stats.mtimeMs, size: stats.size, bytes, contentHash: hashBytes(bytes) });
        }
    }
    const files = existing === undefined ? {} : { ...existing.files };
    let added = 0, updated = 0, removed = 0, unchanged = 0;
    for (const [relative, file] of current) {
        throwIfAborted(context.signal);
        const previous = files[relative];
        const contentUnchanged = previous !== undefined && previous.contentHash === file.contentHash && previous.size === file.size;
        // A non-fast refresh is also the boundary for dynamic profile applicability
        // and diagnostics. Profile callbacks may depend on external workspace state.
        if (contentUnchanged && profiles.length === 0) {
            unchanged += 1;
            continue;
        }
        const next = await parseEntry(file, relative, context, roots.workspaceRoot, profiles);
        if (contentUnchanged && profileDataEqual(previous.profileData, next.profileData)) {
            unchanged += 1;
            continue;
        }
        files[relative] = next;
        previous === undefined ? added += 1 : updated += 1;
    }
    for (const relative of Object.keys(files)) {
        if (!current.has(relative)) {
            delete files[relative];
            removed += 1;
        }
    }
    const profileCatalog = profiles.map((profile) => Object.freeze({ profileId: profile.id, packageName: profile.owner.packageName, packageVersion: profile.owner.packageVersion, contractVersion: 1 }))
        .sort((left, right) => left.profileId.localeCompare(right.profileId));
    const refreshed = existing === undefined || request.rebuild === true || added + updated + removed > 0;
    const index = Object.freeze({
        schema: ARTIFACT_INDEX_SCHEMA,
        version: ARTIFACT_INDEX_VERSION,
        generatedAt: refreshed ? new Date().toISOString() : existing.generatedAt,
        workspaceRoot: normalizePath(roots.workspaceRoot),
        docsRoot: normalizePath(roots.docsRoot),
        todosRoot: normalizePath(roots.todosRoot),
        rootIdentity: roots.rootIdentity,
        profiles: Object.freeze(profileCatalog),
        files: Object.freeze(files),
    });
    if (refreshed) {
        await failureInjector?.("before_index_write", { indexPath });
        await assertPhysicalContainment(roots.workspaceRoot, indexPath, "indexPath");
        await writeJsonAtomic(indexPath, index, ownership.kind !== "absent", failureInjector);
        await failureInjector?.("after_index_write", { indexPath });
    }
    const statsAfter = await stat(indexPath);
    memoryCache.set(cacheKey(indexPath), { index, mtimeMs: statsAfter.mtimeMs, size: statsAfter.size, validatedAtMs: Date.now() });
    dirtyIndexes.delete(cacheKey(indexPath));
    return Object.freeze({ index, indexPath, refreshed, fastPath: false, freshnessMode: mode, stats: Object.freeze({ added, updated, removed, unchanged }), orphanTempsRemoved: Object.freeze([...orphanTempsRemoved]) });
}
async function parseEntry(file, relative, context, workspaceRoot, profiles) {
    const text = file.bytes.toString("utf8");
    const parsed = parseMarkdown(text);
    const kind = detectKind(relative, file.root);
    const candidate = Object.freeze({ path: relative, kind: kind === "other-doc" ? "doc" : kind, frontmatter: parsed.frontmatter, body: parsed.body });
    const profileData = [];
    for (const profile of profiles) {
        throwIfAborted(context.signal);
        let applicable = false;
        let validation;
        try {
            applicable = profile.artifactKinds.length === 0 || profile.artifactKinds.includes(candidate.kind)
                ? profile.appliesTo === undefined || await profile.appliesTo(context, { workspaceRoot, artifactPath: file.absolute, signal: context.signal })
                : false;
            if (applicable) {
                validation = { outcome: "valid" };
                for (const validator of profile.validators) {
                    validation = await validator.validate(context, { operation: "index", workspaceRoot, artifact: candidate, signal: context.signal });
                    assertArtifactValidationResultV1(validation);
                    if (validation.outcome !== "valid")
                        break;
                }
            }
        }
        catch (error) {
            throwIfAborted(context.signal);
            applicable = true;
            validation = { outcome: "error", code: "profile_validation_error", retryable: false };
        }
        if (!applicable || validation === undefined)
            continue;
        profileData.push(Object.freeze({ profileId: profile.id, packageName: profile.owner.packageName, packageVersion: profile.owner.packageVersion, contractVersion: 1, validation }));
    }
    const title = extractTitle(parsed.body, parsed.frontmatter);
    return Object.freeze({
        path: relative,
        root: file.root,
        kind,
        mtimeMs: file.mtimeMs,
        size: file.size,
        contentHash: file.contentHash,
        ...(title === undefined ? {} : { title }),
        frontmatter: parsed.frontmatter,
        frontmatterMalformed: parsed.malformed,
        headings: Object.freeze(extractHeadings(parsed.body)),
        bodyPreview: parsed.body.slice(0, BODY_PREVIEW_CHARS),
        linksTo: Object.freeze(extractArtifactLinks(parsed.body)),
        profileData: Object.freeze(profileData),
    });
}
/** A safe summary of the top-level metadata actually indexed. */
export function observedFieldCatalog(index, options = {}) {
    const valuesByField = new Map();
    for (const entry of Object.values(index.files))
        for (const [name, value] of Object.entries(entry.frontmatter)) {
            const current = valuesByField.get(name) ?? { documentCount: 0, primitiveTypes: new Set(), values: new Set(), valuesCapped: false };
            if (!valuesByField.has(name))
                valuesByField.set(name, current);
            current.documentCount += 1;
            for (const scalar of catalogScalars(value)) {
                current.primitiveTypes.add(scalar.type);
                // A repeat of one of the first 100 values is not evidence that the
                // distinct-value count exceeded its display boundary.
                if (current.values.has(scalar.value))
                    continue;
                if (current.values.size < 100)
                    current.values.add(scalar.value);
                else
                    current.valuesCapped = true;
            }
        }
    const all = [...valuesByField.entries()].sort(([left], [right]) => left.localeCompare(right));
    const requested = options.fieldNames === undefined ? undefined : new Set(options.fieldNames);
    const selected = requested === undefined ? all : all.filter(([name]) => requested.has(name));
    const maxFields = options.maxFields === undefined ? selected.length : Math.max(0, Math.floor(options.maxFields));
    const fields = selected.slice(0, maxFields).map(([name, data]) => Object.freeze({
        name,
        documentCount: data.documentCount,
        ...(options.detailed === true ? {
            inferredPrimitiveTypes: Object.freeze([...data.primitiveTypes].sort()),
            distinctCount: data.values.size,
            distinctCountCapped: data.valuesCapped,
        } : {}),
        ...(options.includeSamples === true ? { sampleValues: Object.freeze(isSensitiveFieldName(name) ? [] : [...data.values].filter(isSafeCatalogSample).sort().slice(0, 3)) } : {}),
    }));
    return Object.freeze({
        fields: Object.freeze(fields),
        totalFieldCount: all.length,
        returnedFieldCount: fields.length,
        omittedFieldCount: Math.max(0, all.length - fields.length),
        truncated: selected.length > fields.length || selected.length !== all.length,
    });
}
export async function inspectIndexOwnership(indexPath) {
    let text;
    try {
        const stats = await lstat(indexPath);
        if (!stats.isFile())
            return { kind: "occupied", reason: "not_a_regular_file" };
        const physical = await realpath(indexPath);
        if (collisionKey(physical) !== collisionKey(indexPath))
            return { kind: "occupied", reason: "symlink_or_junction" };
        text = await readFile(indexPath, "utf8");
    }
    catch (error) {
        if (hasCode(error, "ENOENT"))
            return { kind: "absent" };
        return { kind: "occupied", reason: "unreadable" };
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return { kind: "occupied", reason: "invalid_json" };
    }
    if (isLegacyIndexV4(value))
        return { kind: "legacy" };
    try {
        return { kind: "canonical", index: validateArtifactIndexV1(value) };
    }
    catch (error) {
        return { kind: "occupied", reason: error instanceof Error ? error.message : "invalid_schema" };
    }
}
export function validateArtifactIndexV1(value) {
    const record = asRecord(value, "index");
    if (record.schema !== ARTIFACT_INDEX_SCHEMA || record.version !== 1)
        throw new TypeError("schema/version mismatch");
    for (const field of ["generatedAt", "workspaceRoot", "docsRoot", "todosRoot", "rootIdentity"])
        if (typeof record[field] !== "string" || record[field] === "")
            throw new TypeError(`${field} missing`);
    if (!Number.isFinite(Date.parse(record.generatedAt)))
        throw new TypeError("generatedAt invalid");
    if (!/^sha256:[a-f0-9]{64}$/u.test(record.rootIdentity))
        throw new TypeError("rootIdentity invalid");
    if (!Array.isArray(record.profiles))
        throw new TypeError("profiles invalid");
    for (const profile of record.profiles) {
        const item = asRecord(profile, "profile");
        if (typeof item.profileId !== "string" || typeof item.packageName !== "string" || typeof item.packageVersion !== "string" || item.contractVersion !== 1)
            throw new TypeError("profile shape invalid");
    }
    const files = asRecord(record.files, "files");
    for (const [key, entryValue] of Object.entries(files)) {
        const entry = asRecord(entryValue, "entry");
        if (entry.path !== key || !/^(?:docs|todos)\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/u.test(key) || (entry.root !== "docs" && entry.root !== "todos") || !["doc", "solution", "plan", "memory", "todo", "other-doc"].includes(String(entry.kind)))
            throw new TypeError("entry identity invalid");
        if (!Number.isFinite(entry.mtimeMs) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^sha256:[a-f0-9]{64}$/u.test(String(entry.contentHash)))
            throw new TypeError("entry stat/hash invalid");
        if (entry.title !== undefined && typeof entry.title !== "string")
            throw new TypeError("entry title invalid");
        asRecord(entry.frontmatter, "entry.frontmatter");
        if (typeof entry.frontmatterMalformed !== "boolean" || !isStringArray(entry.headings) || typeof entry.bodyPreview !== "string" || !isStringArray(entry.linksTo) || !Array.isArray(entry.profileData))
            throw new TypeError("entry content invalid");
        for (const profileValue of entry.profileData) {
            const profile = asRecord(profileValue, "entry.profileData");
            if (typeof profile.profileId !== "string" || typeof profile.packageName !== "string" || typeof profile.packageVersion !== "string" || profile.contractVersion !== 1)
                throw new TypeError("entry profileData identity invalid");
            const validation = asRecord(profile.validation, "entry.profileData.validation");
            if (!["valid", "invalid", "conflict", "unavailable", "error"].includes(String(validation.outcome)))
                throw new TypeError("entry profileData validation invalid");
        }
    }
    return value;
}
export function markIndexesDirtyForPath(cwd, rawPath) {
    if (typeof rawPath !== "string" || rawPath.trim() === "")
        return;
    const target = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(cwd, rawPath);
    for (const [indexPath, roots] of activeRoots)
        if (isPathInside(roots.docsRoot, target) || isPathInside(roots.todosRoot, target))
            dirtyIndexes.add(indexPath);
}
export function trackArtifactToolResult(event, cwd) {
    const value = typeof event === "object" && event !== null ? event : {};
    if (value.isError)
        return;
    if (value.toolName === "write" || value.toolName === "edit")
        markIndexesDirtyForPath(cwd, value.input?.path);
    if (value.toolName === "bash" && commandMayMutateArtifacts(value.input?.command))
        for (const indexPath of activeRoots.keys())
            dirtyIndexes.add(indexPath);
}
export function commandMayMutateArtifacts(command) {
    return typeof command === "string" && /(docs|todos|\.md)/iu.test(command) && /\b(rm|del|erase|mv|move|cp|copy|ren|rename|mkdir|touch|tee|echo|python|node|perl|sed|powershell|pwsh)\b|>|>>/iu.test(command);
}
async function listMarkdownFiles(root, signal) {
    if (!await exists(root))
        return [];
    const physicalRoot = await physicalDirectory(root);
    const output = [];
    const stack = [physicalRoot];
    const ignored = new Set([".git", ".pi-project-artifacts", ".compound-game-dev", "node_modules"]);
    while (stack.length > 0) {
        throwIfAborted(signal);
        const current = stack.pop();
        const entries = await readdir(current, { withFileTypes: true });
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (entry.isSymbolicLink())
                continue;
            const child = path.join(current, entry.name);
            if (entry.isDirectory() && !ignored.has(entry.name))
                stack.push(child);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
                const physical = await realpath(child);
                if (!isPathInside(physicalRoot, physical))
                    throw new ProjectArtifactError("artifact_path_escape", `Artifact escaped its root: ${normalizePath(child)}`);
                output.push(physical);
            }
        }
    }
    return output.sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));
}
function detectKind(relative, root) {
    if (root === "todos")
        return "todo";
    const underRoot = normalizePath(relative).replace(/^docs\//u, "").toLowerCase();
    if (underRoot.startsWith("solutions/"))
        return "solution";
    if (underRoot.startsWith("plans/"))
        return "plan";
    if (underRoot.startsWith("memories/"))
        return "memory";
    return "other-doc";
}
function rootsMatch(index, roots) { return index.rootIdentity === roots.rootIdentity && normalizeForIdentity(index.workspaceRoot) === normalizeForIdentity(roots.workspaceRoot) && normalizeForIdentity(index.docsRoot) === normalizeForIdentity(roots.docsRoot) && normalizeForIdentity(index.todosRoot) === normalizeForIdentity(roots.todosRoot); }
function profileDataEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}
function profilesMatch(index, profiles) {
    const expected = profiles.map((profile) => `${profile.id}\0${profile.owner.packageName}\0${profile.owner.packageVersion}\0${profile.contractVersion}`).sort();
    const actual = index.profiles.map((profile) => `${profile.profileId}\0${profile.packageName}\0${profile.packageVersion}\0${profile.contractVersion}`).sort();
    return JSON.stringify(expected) === JSON.stringify(actual);
}
async function loadCanonicalIndex(indexPath) {
    try {
        const stats = await stat(indexPath);
        const cached = memoryCache.get(cacheKey(indexPath));
        if (cached !== undefined && cached.size === stats.size && Math.abs(cached.mtimeMs - stats.mtimeMs) <= 1)
            return cached.index;
        const index = validateArtifactIndexV1(JSON.parse(await readFile(indexPath, "utf8")));
        memoryCache.set(cacheKey(indexPath), { index, mtimeMs: stats.mtimeMs, size: stats.size, validatedAtMs: 0 });
        return index;
    }
    catch {
        memoryCache.delete(cacheKey(indexPath));
        return undefined;
    }
}
function isLegacyIndexV4(value) {
    try {
        const record = asRecord(value, "legacy");
        if (record.version !== 4 || typeof record.generatedAt !== "string" || !Number.isFinite(Date.parse(record.generatedAt)) || typeof record.workspaceRoot !== "string")
            return false;
        if (record.docsRoot !== undefined && typeof record.docsRoot !== "string")
            return false;
        if (record.todosRoot !== undefined && typeof record.todosRoot !== "string")
            return false;
        const files = asRecord(record.files, "legacy.files");
        for (const [key, entryValue] of Object.entries(files)) {
            const entry = asRecord(entryValue, "legacy.entry");
            if (entry.path !== key || (entry.root !== "docs" && entry.root !== "todos") || !["doc", "solution", "plan", "memory", "todo", "other-doc"].includes(String(entry.kind)))
                return false;
            if (!Number.isFinite(entry.mtimeMs) || !Number.isFinite(entry.size) || !isStringArray(entry.headings) || (entry.frontmatter !== undefined && (entry.frontmatter === null || typeof entry.frontmatter !== "object" || Array.isArray(entry.frontmatter))))
                return false;
            if (entry.title !== undefined && typeof entry.title !== "string")
                return false;
            if (entry.body !== undefined && typeof entry.body !== "string")
                return false;
            if (entry.bodyPreview !== undefined && typeof entry.bodyPreview !== "string")
                return false;
            if (entry.linksTo !== undefined && !isStringArray(entry.linksTo))
                return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
function lockOwner(indexPath, rootIdentityValue) { return Object.freeze({ schema: "@aefree/pi-project-artifacts/lock", version: 1, owner: "artifact-index", pid: process.pid, createdAt: new Date().toISOString(), indexPath: normalizePath(indexPath), rootIdentity: rootIdentityValue }); }
function rootIdentity(workspaceRoot, docsRoot, todosRoot) { return `sha256:${createHash("sha256").update([workspaceRoot, docsRoot, todosRoot].map(normalizeForIdentity).join("\n")).digest("hex")}`; }
function hashBytes(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function cacheKey(value) { return normalizeForIdentity(value); }
function emptyStats() { return Object.freeze({ added: 0, updated: 0, removed: 0, unchanged: 0 }); }
async function exists(value) { try {
    await lstat(value);
    return true;
}
catch (error) {
    if (hasCode(error, "ENOENT"))
        return false;
    throw error;
} }
function hasCode(error, code) { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
function catalogScalars(value) {
    if (value === null)
        return [{ type: "null", value: "null" }];
    if (typeof value === "string")
        return [{ type: "string", value }];
    if (typeof value === "number" && Number.isFinite(value))
        return [{ type: "number", value: String(value) }];
    if (typeof value === "boolean")
        return [{ type: "boolean", value: String(value) }];
    return Array.isArray(value) ? value.flatMap(catalogScalars) : [];
}
function isSensitiveFieldName(name) {
    // Metadata names commonly carry credentials even when their values do not
    // match a recognizable provider-specific format. Keep their counts/types,
    // but never surface examples. Normalize camelCase and separators first so
    // apiKey, api_key, and api-key are treated the same way.
    const normalized = name.normalize("NFKC").replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/gu, "_");
    return /(?:^|_)(?:api_?key|access_?key|private_?key|key|token|secret|password|credential|auth(?:entication|orization)?|cookie)(?:_|$)/u.test(normalized);
}
function isSafeCatalogSample(value) {
    return value.length > 0 && value.length <= 80 && !/[\r\n]/u.test(value) && !looksLikeCredential(value) && !looksLikeAbsolutePath(value);
}
/** Catalog examples must not leak a machine layout through absolute paths. */
function looksLikeAbsolutePath(value) {
    const sample = value.trim();
    return /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+)/u.test(sample)
        || /^(?:\.{1,2}[\\/]|(?:[^\\/\s]+[\\/])+[^\\/\s]+)$/u.test(sample);
}
/** Conservative recognition for credentials stored under otherwise neutral names. */
function looksLikeCredential(value) {
    // Do not spend unbounded work classifying a value that is already too large
    // to safely expose; redact it conservatively instead.
    if (value.length > 512)
        return true;
    const sample = value.trim();
    return /^(?:AKIA|ASIA)[A-Z0-9]{16}$/u.test(sample) // AWS access keys
        || /^(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}$/u.test(sample) // GitHub tokens
        || /^sk-[A-Za-z0-9_-]{16,}$/u.test(sample) // API keys such as OpenAI
        || /^sk_(?:live|test)_[A-Za-z0-9]{16,}$/u.test(sample) // Stripe live/test keys
        || /^AIza[A-Za-z0-9_-]{20,}$/u.test(sample) // Google API keys
        || /^glpat-[A-Za-z0-9_-]{16,}$/u.test(sample) // GitLab personal/project tokens
        || /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/u.test(sample) // URL userinfo
        || /^xox[baprs]-[A-Za-z0-9-]{10,}$/u.test(sample) // Slack tokens
        || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(sample) // JWTs
        || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(sample);
}
/** Removes credentials from metadata returned to callers while preserving safe fields. */
export function safeFrontmatterForDisplay(frontmatter) {
    const output = {};
    for (const [name, value] of Object.entries(frontmatter)) {
        if (isSensitiveFieldName(name))
            continue;
        output[name] = redactSensitiveValue(value);
    }
    return Object.freeze(output);
}
function redactSensitiveValue(value) {
    if (typeof value === "string")
        return looksLikeCredential(value) ? "[redacted]" : value;
    if (Array.isArray(value))
        return Object.freeze(value.map(redactSensitiveValue));
    if (value !== null && typeof value === "object") {
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([name, child]) => [name, isSensitiveFieldName(name) ? "[redacted]" : redactSensitiveValue(child)])));
    }
    return value;
}
function asRecord(value, label) { if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} must be an object`); return value; }
function isStringArray(value) { return Array.isArray(value) && value.every((entry) => typeof entry === "string"); }
