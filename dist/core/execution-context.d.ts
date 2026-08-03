import type { ArtifactExecutionContextV1 } from "../contracts/v1/index.js";
export type ArtifactExecutionBindingV1 = Readonly<{
    scope: object;
    cwd: string;
}>;
/** Package-copy-safe Pi-adapter bridge; scope and approved cwd are never added to the public context object. */
export declare function bindArtifactExecutionScopeV1(context: ArtifactExecutionContextV1, scope: object): ArtifactExecutionContextV1;
/** Internal service lookup for the current invocation only. */
export declare function artifactExecutionBindingV1(context: ArtifactExecutionContextV1): ArtifactExecutionBindingV1 | undefined;
