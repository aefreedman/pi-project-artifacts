import * as path from "node:path";
/**
 * Invocation-only association between a public execution context and its
 * ambient registry scope. Weak keys ensure completed contexts do not retain
 * their session scopes; the scope is never added to the contract object.
 */
const ARTIFACT_INVOCATION_SCOPES_SYMBOL_V1 = Symbol.for("@aefree/pi-project-artifacts/invocation-scopes/v1");
const scopeState = globalThis;
function invocationScopes(create) {
    const current = scopeState[ARTIFACT_INVOCATION_SCOPES_SYMBOL_V1];
    if (current !== undefined || !create)
        return current;
    const next = new WeakMap();
    scopeState[ARTIFACT_INVOCATION_SCOPES_SYMBOL_V1] = next;
    return next;
}
/** Package-copy-safe Pi-adapter bridge; scope and approved cwd are never added to the public context object. */
export function bindArtifactExecutionScopeV1(context, scope) {
    invocationScopes(true).set(context, Object.freeze({ scope, cwd: path.resolve(context.cwd) }));
    return context;
}
/** Internal service lookup for the current invocation only. */
export function artifactExecutionBindingV1(context) {
    return invocationScopes(false)?.get(context);
}
