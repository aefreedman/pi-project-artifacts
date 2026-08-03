export type ArtifactRoots = Readonly<{
    workspaceRoot: string;
    docsRoot: string;
    todosRoot: string;
    rootIdentity: string;
}>;
export declare function normalizePath(value: string): string;
export declare function normalizeForIdentity(value: string): string;
export declare function isPathInside(parent: string, candidate: string): boolean;
export declare function collisionKey(value: string): string;
export declare function resolveFrom(base: string, raw: string | undefined, fallback: string): string;
/** Resolve roots lexically. Physical checks are performed immediately before I/O. */
export declare function resolveArtifactRoots(cwd: string, options: {
    workspaceRoot?: string;
    docsRoot?: string;
    todosRoot?: string;
}): ArtifactRoots;
/**
 * Resolve an existing directory physically. If create=true, creates it first. The
 * resolved root itself may be a symlink, but descendants are always compared to
 * this physical identity and symlink entries are never followed by walkers.
 */
export declare function physicalDirectory(target: string, create?: boolean): Promise<string>;
/** Resolve an existing directory, proving its physical identity remains under an invocation root. */
export declare function scopedPhysicalDirectory(physicalExecutionRoot: string, target: string, label: string): Promise<string>;
/** Resolve a directory physically when present, or return a contained physical reconstruction when absent. */
export declare function scopedPhysicalDirectoryOrMissing(physicalExecutionRoot: string, target: string, label: string): Promise<string>;
/**
 * Prove a path's nearest existing ancestry resolves under physicalRoot. This also
 * rejects existing symlink/junction escapes and new targets beneath such escapes.
 */
export declare function assertPhysicalContainment(physicalRoot: string, target: string, label?: string): Promise<string>;
