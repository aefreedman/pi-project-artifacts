/** Structured domain error. Pi adapters signal it by throwing. */
export class ProjectArtifactError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "ProjectArtifactError";
        this.code = code;
        this.details = Object.freeze({ code, ...details });
    }
}
export function errorCode(error) {
    return error instanceof ProjectArtifactError
        ? error.code
        : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
            ? error.code
            : undefined;
}
export function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new ProjectArtifactError("aborted", "Artifact operation was aborted.");
}
//# sourceMappingURL=errors.js.map