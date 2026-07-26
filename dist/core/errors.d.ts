export type ArtifactErrorDetails = Readonly<Record<string, unknown>>;
/** Structured domain error. Pi adapters signal it by throwing. */
export declare class ProjectArtifactError extends Error {
    readonly code: string;
    readonly details: ArtifactErrorDetails;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function errorCode(error: unknown): string | undefined;
export declare function throwIfAborted(signal?: AbortSignal): void;
//# sourceMappingURL=errors.d.ts.map