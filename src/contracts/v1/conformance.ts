import { assertRegistryConformance, type RegistryConformanceReport } from "@aefree/pi-capability-registry/conformance";
import {
  assertArtifactExecutionContextV1,
  assertArtifactValidationResultV1,
  createArtifactProfileRegistryV1,
  assertArtifactSearchResultV1,
  assertTodoLifecycleRequestV1,
  assertTodoLifecycleResultForRequestV1,
  assertTodoLifecycleServiceV1,
  type ArtifactExecutionContextV1,
  type ArtifactProfileV1,
  type ArtifactSearchRequestV1,
  type ArtifactSearchServiceV1,
  type ArtifactValidationResultV1,
  type TodoLifecycleRequestV1,
  type TodoLifecycleServiceV1,
} from "./index.js";

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
    readonly kind: "doc" | "solution" | "plan" | "memory" | "todo" | "other";
    readonly frontmatter: Readonly<Record<string, unknown>>;
    readonly body?: string;
  };
  readonly invalidArtifact?: {
    readonly path: string;
    readonly kind: "doc" | "solution" | "plan" | "memory" | "todo" | "other";
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
export async function assertArtifactProfileConformanceV1(
  subject: ArtifactProfileConformanceSubjectV1,
  cancellation: CancellationConformanceOptionsV1 = {},
): Promise<ArtifactProfileConformanceReportV1> {
  const registry = assertRegistryConformance({
    createRegistry: createArtifactProfileRegistryV1,
    createRecord: ({ id, owner, marker }) => ({
      ...subject.createProfile(marker),
      id,
      owner: { ...owner, packageVersion: owner.packageVersion ?? "1.0.0", registeredBy: "conformance" },
      marker,
    }),
    getMarker: (record) => Number((record as ArtifactProfileV1 & { marker?: number }).marker ?? 0),
  });

  const profile = subject.createProfile();
  if (profile.validators.length === 0) throw new Error("Artifact profile conformance failed: at least one validator is required");
  const validator = profile.validators[0]!;
  const first = Object.freeze({ cwd: "/fixture/a", requestId: "a", signal: new AbortController().signal }) satisfies ArtifactExecutionContextV1;
  const second = Object.freeze({ cwd: "/fixture/b", requestId: "b", signal: new AbortController().signal }) satisfies ArtifactExecutionContextV1;
  const run = async (context: ArtifactExecutionContextV1, artifact: ArtifactProfileConformanceSubjectV1["validArtifact"]): Promise<ArtifactValidationResultV1> => {
    assertArtifactExecutionContextV1(context);
    const result = await validator.validate(context, {
      operation: "index",
      workspaceRoot: "/fixture",
      artifact,
      signal: context.signal,
    });
    assertArtifactValidationResultV1(result);
    return result;
  };
  const valid = await run(first, subject.validArtifact);
  if (valid.outcome !== "valid") throw new Error("Artifact profile conformance failed: valid fixture rejected");
  await run(second, subject.validArtifact);
  const checks = ["runtime validation", "valid fixture", "fresh-context invocation"];
  if (profile.appliesTo !== undefined) {
    const applicable = await profile.appliesTo(first, {
      workspaceRoot: "/fixture",
      artifactPath: subject.validArtifact.path,
      signal: first.signal,
    });
    if (typeof applicable !== "boolean") throw new Error("Artifact profile conformance failed: applicability must return boolean");
    checks.push("profile applicability");
  }
  if (subject.invalidArtifact !== undefined) {
    const invalid = await run(first, subject.invalidArtifact);
    if (invalid.outcome !== "invalid" && invalid.outcome !== "conflict") throw new Error("Artifact profile conformance failed: invalid fixture accepted");
    checks.push("invalid fixture");
  }

  await assertInFlightCancellation(
    "Artifact validator conformance",
    (context) => validator.validate(context, {
      operation: "index", workspaceRoot: "/fixture", artifact: subject.validArtifact, signal: context.signal,
    }),
    assertArtifactValidationResultV1,
    cancellation,
  );
  checks.push("validator in-flight cancellation", "validator sibling isolation");
  if (profile.appliesTo !== undefined) {
    await assertInFlightCancellation(
      "Artifact applicability conformance",
      (context) => profile.appliesTo!(context, {
        workspaceRoot: "/fixture", artifactPath: subject.validArtifact.path, signal: context.signal,
      }),
      (value) => { if (typeof value !== "boolean") throw new Error("Artifact applicability conformance: result must be boolean"); },
      cancellation,
    );
    checks.push("applicability in-flight cancellation", "applicability sibling isolation");
  }
  return Object.freeze({ passed: true as const, checks: Object.freeze(checks), registry });
}

export async function assertArtifactSearchServiceConformanceV1(
  service: ArtifactSearchServiceV1,
  request: ArtifactSearchRequestV1,
  cancellation: CancellationConformanceOptionsV1 = {},
): Promise<Readonly<{ passed: true; checks: readonly string[] }>> {
  const context = Object.freeze({ cwd: "/fixture/result", requestId: "result", signal: new AbortController().signal });
  assertArtifactExecutionContextV1(context);
  assertArtifactSearchResultV1(await service.search(context, request));
  await assertInFlightCancellation("Artifact service conformance", (current) => service.search(current, request), assertArtifactSearchResultV1, cancellation);
  return serviceReport("runtime result validation");
}

export async function assertTodoLifecycleServiceConformanceV1(
  service: TodoLifecycleServiceV1,
  request: TodoLifecycleRequestV1,
  cancellation: CancellationConformanceOptionsV1 = {},
): Promise<Readonly<{ passed: true; checks: readonly string[] }>> {
  // Validate both boundaries before any provider code runs.
  assertTodoLifecycleServiceV1(service);
  assertTodoLifecycleRequestV1(request);
  const context = Object.freeze({ cwd: "/fixture/result", requestId: "result", signal: new AbortController().signal });
  assertArtifactExecutionContextV1(context);
  assertTodoLifecycleResultForRequestV1(await service.execute(context, request), request);
  await assertInFlightCancellation(
    "Todo service conformance",
    (current) => service.execute(current, request),
    (value) => assertTodoLifecycleResultForRequestV1(value, request),
    cancellation,
  );
  return serviceReport("runtime service/request/result correlation");
}

function serviceReport(resultCheck: string): Readonly<{ passed: true; checks: readonly string[] }> {
  return Object.freeze({ passed: true as const, checks: Object.freeze([
    resultCheck,
    "fresh-context invocation",
    "distinct invocation cancellation",
    "in-flight cooperative cancellation",
    "sibling isolation",
  ]) });
}

async function assertInFlightCancellation<T>(
  label: string,
  invoke: (context: ArtifactExecutionContextV1) => Promise<T>,
  validate: (value: unknown) => void,
  options: CancellationConformanceOptionsV1,
): Promise<void> {
  const watchdogMs = options.watchdogMs ?? 250;
  if (!Number.isFinite(watchdogMs) || watchdogMs <= 0) throw new TypeError("watchdogMs must be a positive finite number");
  const controllers = [new AbortController(), new AbortController()];
  const contexts = controllers.map((controller, index) => Object.freeze({
    cwd: `/fixture/cancellation-${index}`, requestId: `cancellation-${index}`, signal: controller.signal,
  })) satisfies ArtifactExecutionContextV1[];
  if (contexts[0]!.signal === contexts[1]!.signal) throw new Error(`${label}: invocation signals must be distinct`);

  const first = observe(invoke(contexts[0]!));
  const sibling = observe(invoke(contexts[1]!));
  controllers[0]!.abort();
  if (!contexts[0]!.signal.aborted || contexts[1]!.signal.aborted) throw new Error(`${label}: invocation cancellation leaked`);

  await Promise.resolve();
  const explicitlyObserved = options.isAbortObserved?.(contexts[0]!.signal) === true;
  if (!explicitlyObserved) {
    const outcome = await within(first, watchdogMs, `${label}: aborted invocation did not settle or explicitly observe abort`);
    if (outcome.status === "fulfilled") validate(outcome.value);
  }
  const siblingOutcome = await within(sibling, watchdogMs, `${label}: unaffected sibling did not settle promptly`);
  if (siblingOutcome.status === "rejected") throw new Error(`${label}: unaffected sibling rejected`, { cause: siblingOutcome.reason });
  validate(siblingOutcome.value);
}

type Observed<T> = { readonly status: "fulfilled"; readonly value: T } | { readonly status: "rejected"; readonly reason: unknown };
function observe<T>(promise: Promise<T>): Promise<Observed<T>> {
  return Promise.resolve(promise).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}
async function within<T>(promise: Promise<T>, watchdogMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), watchdogMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
