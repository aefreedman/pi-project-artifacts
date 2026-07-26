import { type RegistryConformanceReport } from "@aefree/pi-capability-registry/conformance";
import { type ArtifactProfileV1, type ArtifactSearchRequestV1, type ArtifactSearchServiceV1, type TodoLifecycleRequestV1, type TodoLifecycleServiceV1 } from "./index.js";
export interface CancellationConformanceOptionsV1 {
    /** Maximum time an aborted invocation or unaffected sibling may remain unsettled. Defaults to 250 ms. */
    readonly watchdogMs?: number;
    /** Optional side channel for callbacks that explicitly observe abort but intentionally settle later. */
    readonly isAbortObserved?: (signal: AbortSignal) => boolean;
}
export interface ArtifactProfileConformanceSubjectV1 {
    readonly createProfile: (marker?: number) => ArtifactProfileV1;
    readonly validArtifact: {
        readonly path: string;
        readonly kind: "doc" | "solution" | "plan" | "todo" | "other";
        readonly frontmatter: Readonly<Record<string, unknown>>;
        readonly body?: string;
    };
    readonly invalidArtifact?: {
        readonly path: string;
        readonly kind: "doc" | "solution" | "plan" | "todo" | "other";
        readonly frontmatter: Readonly<Record<string, unknown>>;
        readonly body?: string;
    };
}
export interface ArtifactProfileConformanceReportV1 {
    readonly passed: true;
    readonly checks: readonly string[];
    readonly registry: RegistryConformanceReport;
}
/** Framework-neutral profile checks reusable by Unity and future artifact packages. */
export declare function assertArtifactProfileConformanceV1(subject: ArtifactProfileConformanceSubjectV1, cancellation?: CancellationConformanceOptionsV1): Promise<ArtifactProfileConformanceReportV1>;
export declare function assertArtifactSearchServiceConformanceV1(service: ArtifactSearchServiceV1, request: ArtifactSearchRequestV1, cancellation?: CancellationConformanceOptionsV1): Promise<Readonly<{
    passed: true;
    checks: readonly string[];
}>>;
export declare function assertTodoLifecycleServiceConformanceV1(service: TodoLifecycleServiceV1, request: TodoLifecycleRequestV1, cancellation?: CancellationConformanceOptionsV1): Promise<Readonly<{
    passed: true;
    checks: readonly string[];
}>>;
//# sourceMappingURL=conformance.d.ts.map