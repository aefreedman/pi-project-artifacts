import { createHash } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import * as path from "node:path";
import { ProjectArtifactError } from "./errors.js";
export function normalizePath(value) {
    return value.replaceAll("\\", "/");
}
export function normalizeForIdentity(value) {
    const normalized = path.resolve(value).normalize("NFC");
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
export function isPathInside(parent, candidate) {
    const parentId = normalizeForIdentity(parent);
    const candidateId = normalizeForIdentity(candidate);
    const prefix = parentId.endsWith(path.sep) ? parentId : `${parentId}${path.sep}`;
    return candidateId === parentId || candidateId.startsWith(prefix);
}
export function collisionKey(value) {
    return normalizePath(path.resolve(value)).normalize("NFKC").toLowerCase();
}
export function resolveFrom(base, raw, fallback) {
    if (raw === undefined || raw.trim() === "")
        return path.resolve(base, fallback);
    const value = raw.trim().replace(/^@(?=[^@])/u, "");
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(base, value);
}
/** Resolve roots lexically. Physical checks are performed immediately before I/O. */
export function resolveArtifactRoots(cwd, options) {
    const workspaceRoot = resolveFrom(path.resolve(cwd), options.workspaceRoot, ".");
    const docsRoot = resolveFrom(workspaceRoot, options.docsRoot, "docs");
    const todosRoot = resolveFrom(workspaceRoot, options.todosRoot, "todos");
    const identityInput = [workspaceRoot, docsRoot, todosRoot].map(normalizeForIdentity).join("\n");
    const rootIdentity = `sha256:${createHash("sha256").update(identityInput).digest("hex")}`;
    return Object.freeze({ workspaceRoot, docsRoot, todosRoot, rootIdentity });
}
/**
 * Resolve an existing directory physically. If create=true, creates it first. The
 * resolved root itself may be a symlink, but descendants are always compared to
 * this physical identity and symlink entries are never followed by walkers.
 */
export async function physicalDirectory(target, create = false) {
    if (create)
        await mkdir(target, { recursive: true });
    try {
        const stats = await lstat(target);
        if (!stats.isDirectory() && !stats.isSymbolicLink()) {
            throw new ProjectArtifactError("root_not_directory", `Artifact root is not a directory: ${normalizePath(target)}`, { path: normalizePath(target) });
        }
        const physical = await realpath(target);
        const physicalStats = await lstat(physical);
        if (!physicalStats.isDirectory())
            throw new Error("not a directory");
        return path.resolve(physical);
    }
    catch (error) {
        if (error instanceof ProjectArtifactError)
            throw error;
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
        if (code === "ENOENT")
            throw new ProjectArtifactError("root_missing", `Artifact root does not exist: ${normalizePath(target)}`, { path: normalizePath(target) });
        throw new ProjectArtifactError("root_unavailable", `Artifact root could not be resolved physically: ${normalizePath(target)}`, { path: normalizePath(target) });
    }
}
/** Resolve an existing directory, proving its physical identity remains under an invocation root. */
export async function scopedPhysicalDirectory(physicalExecutionRoot, target, label) {
    const contained = await assertPhysicalContainment(physicalExecutionRoot, target, label);
    const physical = await physicalDirectory(contained);
    if (!isPathInside(physicalExecutionRoot, physical)) {
        throw new ProjectArtifactError("path_escape", `${label} escapes the session-approved physical workspace: ${normalizePath(target)}`);
    }
    return physical;
}
/** Resolve a directory physically when present, or return a contained physical reconstruction when absent. */
export async function scopedPhysicalDirectoryOrMissing(physicalExecutionRoot, target, label) {
    const contained = await assertPhysicalContainment(physicalExecutionRoot, target, label);
    try {
        return await scopedPhysicalDirectory(physicalExecutionRoot, contained, label);
    }
    catch (error) {
        if (error instanceof ProjectArtifactError && error.code === "root_missing")
            return contained;
        throw error;
    }
}
/**
 * Prove a path's nearest existing ancestry resolves under physicalRoot. This also
 * rejects existing symlink/junction escapes and new targets beneath such escapes.
 */
export async function assertPhysicalContainment(physicalRoot, target, label = "path") {
    const absolute = path.resolve(target);
    let cursor = absolute;
    const suffix = [];
    while (true) {
        try {
            const physicalAncestor = await realpath(cursor);
            if (!isPathInside(physicalRoot, physicalAncestor)) {
                throw new ProjectArtifactError("path_escape", `${label} escapes its physical root: ${normalizePath(absolute)}`, {
                    path: normalizePath(absolute),
                    physicalRoot: normalizePath(physicalRoot),
                    physicalAncestor: normalizePath(physicalAncestor),
                });
            }
            const reconstructed = path.resolve(physicalAncestor, ...suffix.reverse());
            if (!isPathInside(physicalRoot, reconstructed)) {
                throw new ProjectArtifactError("path_escape", `${label} escapes its physical root: ${normalizePath(absolute)}`);
            }
            return reconstructed;
        }
        catch (error) {
            if (error instanceof ProjectArtifactError)
                throw error;
            const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
            if (code !== "ENOENT") {
                throw new ProjectArtifactError("path_unavailable", `${label} could not be physically resolved: ${normalizePath(absolute)}`);
            }
            const parent = path.dirname(cursor);
            if (parent === cursor)
                throw new ProjectArtifactError("path_escape", `${label} has no existing contained ancestry: ${normalizePath(absolute)}`);
            suffix.push(path.basename(cursor));
            cursor = parent;
        }
    }
}
//# sourceMappingURL=roots.js.map