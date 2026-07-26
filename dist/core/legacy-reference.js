import { open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { createCapabilityRegistry } from "@aefree/pi-capability-registry";
const REGISTRY_KEY = "@aefree/pi-game-dev/legacy-reference-services/v1";
const PACKAGE_NAME = "@aefree/pi-project-artifacts";
const PACKAGE_VERSION = "0.1.0";
const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
/** Exact compatibility rows owned by this package in pi-game-dev's public v1 map. */
export const PROJECT_ARTIFACT_LEGACY_PATHS_V1 = Object.freeze([
    "references/_shared/artifact-path-contract.md",
    "references/_shared/artifact-root-resolution.md",
    "references/_shared/protected-artifacts.md",
    "references/cg-groom-docs/guidance.md",
    "skills/file-todos/assets/todo-template.md",
    "skills/file-todos/references/commands.md",
    "skills/file-todos/references/dependencies.md",
    "skills/file-todos/references/integration.md",
    "skills/file-todos/references/triage.md",
    "skills/file-todos/references/work-logs.md",
    "skills/file-todos/SKILL.md",
]);
export function registerProjectArtifactLegacyReferencesV1(scope) {
    const allowed = new Set(PROJECT_ARTIFACT_LEGACY_PATHS_V1);
    const owner = Object.freeze({ packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION, packageRoot: PACKAGE_ROOT, registeredBy: "dist/pi/index.js" });
    const service = Object.freeze({
        contractVersion: 1,
        id: "legacy-reference.aefree-pi-project-artifacts",
        kind: "legacy-reference-service",
        owner,
        legacyPaths: PROJECT_ARTIFACT_LEGACY_PATHS_V1,
        async read(_context, request) {
            if (request.signal.aborted)
                throw abortError();
            if (!allowed.has(request.legacyPath))
                throw new Error("legacy_resource_unmapped");
            const text = await readBoundedText(path.join(PACKAGE_ROOT, "compatibility", "legacy-reference-v1", ...request.legacyPath.split("/")), request.signal);
            const allLines = text.split(/\r?\n/u);
            const start = Math.max(0, Math.trunc(request.offset ?? 1) - 1);
            const count = request.limit === undefined ? undefined : Math.max(0, Math.trunc(request.limit));
            const content = allLines.slice(start, count === undefined ? undefined : start + count).join("\n");
            const resourceId = `pi-project-artifacts:${request.legacyPath}`;
            return Object.freeze({
                content,
                legacyPath: request.legacyPath,
                resourceId,
                ...(request.offset === undefined ? {} : { offset: request.offset }),
                ...(request.limit === undefined ? {} : { limit: request.limit }),
                lines: content === "" ? 0 : content.split(/\r?\n/u).length,
                totalLines: allLines.length,
                provenance: Object.freeze({ packageName: PACKAGE_NAME, packageVersion: PACKAGE_VERSION, resourceId, contractVersion: 1 }),
            });
        },
    });
    const registry = createCapabilityRegistry({ registryKey: REGISTRY_KEY, contractVersion: 1, compatibleVersions: [1], validate: assertService });
    const token = registry.register(scope, service);
    let active = true;
    return Object.freeze({ token, unregister() { if (!active)
            return false; active = false; return registry.unregister(token); } });
}
async function readBoundedText(file, signal) {
    const handle = await open(file, "r");
    try {
        if (signal.aborted)
            throw abortError();
        const buffer = Buffer.alloc(50 * 1024 + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 50 * 1024)
            throw new Error("resource_too_large");
        const text = buffer.subarray(0, bytesRead).toString("utf8");
        if (text.split(/\r?\n/u).length > 2_000)
            throw new Error("resource_too_large");
        return text;
    }
    finally {
        await handle.close();
    }
}
function assertService(value) {
    const service = value;
    if (!service || service.contractVersion !== 1 || service.kind !== "legacy-reference-service" || typeof service.id !== "string" || !Array.isArray(service.legacyPaths) || typeof service.read !== "function" || typeof service.owner?.packageName !== "string")
        throw new TypeError("invalid LegacyReferenceServiceV1");
}
function abortError() { const error = new Error("Legacy reference read cancelled."); error.name = "AbortError"; return error; }
//# sourceMappingURL=legacy-reference.js.map