import * as path from "node:path";
import type { ArtifactExecutionContextV1 } from "../contracts/v1/index.js";

/**
 * Invocation-only association between a public execution context and its
 * ambient registry scope. Weak keys ensure completed contexts do not retain
 * their session scopes; the scope is never added to the contract object.
 */
const ARTIFACT_INVOCATION_SCOPES_SYMBOL_V1 = Symbol.for("@aefree/pi-project-artifacts/invocation-scopes/v1");
const scopeState = globalThis as Record<PropertyKey, unknown>;
export type ArtifactExecutionBindingV1 = Readonly<{ scope: object; cwd: string }>;
function invocationScopes(create: boolean): WeakMap<ArtifactExecutionContextV1, ArtifactExecutionBindingV1> | undefined {
  const current = scopeState[ARTIFACT_INVOCATION_SCOPES_SYMBOL_V1] as WeakMap<ArtifactExecutionContextV1, ArtifactExecutionBindingV1> | undefined;
  if (current !== undefined || !create) return current;
  const next = new WeakMap<ArtifactExecutionContextV1, ArtifactExecutionBindingV1>();
  scopeState[ARTIFACT_INVOCATION_SCOPES_SYMBOL_V1] = next;
  return next;
}
/** Package-copy-safe Pi-adapter bridge; scope and approved cwd are never added to the public context object. */
export function bindArtifactExecutionScopeV1(
  context: ArtifactExecutionContextV1,
  scope: object,
): ArtifactExecutionContextV1 {
  invocationScopes(true)!.set(context, Object.freeze({ scope, cwd: path.resolve(context.cwd) }));
  return context;
}

/** Internal service lookup for the current invocation only. */
export function artifactExecutionBindingV1(context: ArtifactExecutionContextV1): ArtifactExecutionBindingV1 | undefined {
  return invocationScopes(false)?.get(context);
}
