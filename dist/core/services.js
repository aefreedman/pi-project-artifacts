import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { createArtifactProfileRegistryV1, resolveArtifactProfilesV1, } from "../contracts/v1/index.js";
import { executeArtifactSearch, requireComposableProfiles } from "./artifact-search.js";
import { artifactExecutionBindingV1 } from "./execution-context.js";
import { executeTodoLifecycle } from "./todo-lifecycle.js";
const OWNER = Object.freeze({
    packageName: "@aefree/pi-project-artifacts",
    packageVersion: "0.1.0",
    packageRoot: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
    registeredBy: "dist/pi/index.js",
});
export function createArtifactSearchServiceV1() {
    // The registry object is scope-neutral. The current scope is resolved from
    // the invocation context so this callback cannot retain a Pi session.
    const profileRegistry = createArtifactProfileRegistryV1();
    return Object.freeze({
        contractVersion: 1,
        id: "project-artifact-search.v1",
        kind: "artifact-search-service",
        owner: OWNER,
        async search(context, request) {
            const binding = artifactExecutionBindingV1(context);
            if (binding === undefined)
                throw new Error("Artifact search execution context is not bound to the current Pi session.");
            const boundedContext = Object.freeze({ ...context, cwd: binding.cwd });
            const resolution = resolveArtifactProfilesV1(binding.scope, profileRegistry);
            requireComposableProfiles(resolution);
            return await executeArtifactSearch(boundedContext, request, resolution);
        },
    });
}
export function createTodoLifecycleServiceV1(options = {}) {
    return Object.freeze({
        contractVersion: 1,
        id: "project-file-todos.v1",
        kind: "todo-lifecycle-service",
        owner: OWNER,
        async execute(context, request) {
            const binding = artifactExecutionBindingV1(context);
            if (binding === undefined)
                throw new Error("Todo execution context is not bound to the current Pi session.");
            return await executeTodoLifecycle(Object.freeze({ ...context, cwd: binding.cwd }), request, options);
        },
    });
}
//# sourceMappingURL=services.js.map