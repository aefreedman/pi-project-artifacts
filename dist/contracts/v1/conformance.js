import { assertRegistryConformance } from "@aefree/pi-capability-registry/conformance";
import { assertArtifactExecutionContextV1, assertArtifactValidationResultV1, createArtifactProfileRegistryV1, assertArtifactSearchResultV1, assertTodoLifecycleRequestV1, assertTodoLifecycleResultForRequestV1, assertTodoLifecycleServiceV1, } from "./index.js";
/** Framework-neutral profile checks reusable by Unity and future artifact packages. */
export async function assertArtifactProfileConformanceV1(subject, cancellation = {}) {
    const registry = assertRegistryConformance({
        createRegistry: createArtifactProfileRegistryV1,
        createRecord: ({ id, owner, marker }) => ({
            ...subject.createProfile(marker),
            id,
            owner: { ...owner, packageVersion: owner.packageVersion ?? "1.0.0", registeredBy: "conformance" },
            marker,
        }),
        getMarker: (record) => Number(record.marker ?? 0),
    });
    const profile = subject.createProfile();
    if (profile.validators.length === 0)
        throw new Error("Artifact profile conformance failed: at least one validator is required");
    const validator = profile.validators[0];
    const first = Object.freeze({ cwd: "/fixture/a", requestId: "a", signal: new AbortController().signal });
    const second = Object.freeze({ cwd: "/fixture/b", requestId: "b", signal: new AbortController().signal });
    const run = async (context, artifact) => {
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
    if (valid.outcome !== "valid")
        throw new Error("Artifact profile conformance failed: valid fixture rejected");
    await run(second, subject.validArtifact);
    const checks = ["runtime validation", "valid fixture", "fresh-context invocation"];
    if (profile.appliesTo !== undefined) {
        const applicable = await profile.appliesTo(first, {
            workspaceRoot: "/fixture",
            artifactPath: subject.validArtifact.path,
            signal: first.signal,
        });
        if (typeof applicable !== "boolean")
            throw new Error("Artifact profile conformance failed: applicability must return boolean");
        checks.push("profile applicability");
    }
    if (subject.invalidArtifact !== undefined) {
        const invalid = await run(first, subject.invalidArtifact);
        if (invalid.outcome !== "invalid" && invalid.outcome !== "conflict")
            throw new Error("Artifact profile conformance failed: invalid fixture accepted");
        checks.push("invalid fixture");
    }
    await assertInFlightCancellation("Artifact validator conformance", (context) => validator.validate(context, {
        operation: "index", workspaceRoot: "/fixture", artifact: subject.validArtifact, signal: context.signal,
    }), assertArtifactValidationResultV1, cancellation);
    checks.push("validator in-flight cancellation", "validator sibling isolation");
    if (profile.appliesTo !== undefined) {
        await assertInFlightCancellation("Artifact applicability conformance", (context) => profile.appliesTo(context, {
            workspaceRoot: "/fixture", artifactPath: subject.validArtifact.path, signal: context.signal,
        }), (value) => { if (typeof value !== "boolean")
            throw new Error("Artifact applicability conformance: result must be boolean"); }, cancellation);
        checks.push("applicability in-flight cancellation", "applicability sibling isolation");
    }
    return Object.freeze({ passed: true, checks: Object.freeze(checks), registry });
}
export async function assertArtifactSearchServiceConformanceV1(service, request, cancellation = {}) {
    const context = Object.freeze({ cwd: "/fixture/result", requestId: "result", signal: new AbortController().signal });
    assertArtifactExecutionContextV1(context);
    assertArtifactSearchResultV1(await service.search(context, request));
    await assertInFlightCancellation("Artifact service conformance", (current) => service.search(current, request), assertArtifactSearchResultV1, cancellation);
    return serviceReport("runtime result validation");
}
export async function assertTodoLifecycleServiceConformanceV1(service, request, cancellation = {}) {
    // Validate both boundaries before any provider code runs.
    assertTodoLifecycleServiceV1(service);
    assertTodoLifecycleRequestV1(request);
    const context = Object.freeze({ cwd: "/fixture/result", requestId: "result", signal: new AbortController().signal });
    assertArtifactExecutionContextV1(context);
    assertTodoLifecycleResultForRequestV1(await service.execute(context, request), request);
    await assertInFlightCancellation("Todo service conformance", (current) => service.execute(current, request), (value) => assertTodoLifecycleResultForRequestV1(value, request), cancellation);
    return serviceReport("runtime service/request/result correlation");
}
function serviceReport(resultCheck) {
    return Object.freeze({ passed: true, checks: Object.freeze([
            resultCheck,
            "fresh-context invocation",
            "distinct invocation cancellation",
            "in-flight cooperative cancellation",
            "sibling isolation",
        ]) });
}
async function assertInFlightCancellation(label, invoke, validate, options) {
    const watchdogMs = options.watchdogMs ?? 250;
    if (!Number.isFinite(watchdogMs) || watchdogMs <= 0)
        throw new TypeError("watchdogMs must be a positive finite number");
    const controllers = [new AbortController(), new AbortController()];
    const contexts = controllers.map((controller, index) => Object.freeze({
        cwd: `/fixture/cancellation-${index}`, requestId: `cancellation-${index}`, signal: controller.signal,
    }));
    if (contexts[0].signal === contexts[1].signal)
        throw new Error(`${label}: invocation signals must be distinct`);
    const first = observe(invoke(contexts[0]));
    const sibling = observe(invoke(contexts[1]));
    controllers[0].abort();
    if (!contexts[0].signal.aborted || contexts[1].signal.aborted)
        throw new Error(`${label}: invocation cancellation leaked`);
    await Promise.resolve();
    const explicitlyObserved = options.isAbortObserved?.(contexts[0].signal) === true;
    if (!explicitlyObserved) {
        const outcome = await within(first, watchdogMs, `${label}: aborted invocation did not settle or explicitly observe abort`);
        if (outcome.status === "fulfilled")
            validate(outcome.value);
    }
    const siblingOutcome = await within(sibling, watchdogMs, `${label}: unaffected sibling did not settle promptly`);
    if (siblingOutcome.status === "rejected")
        throw new Error(`${label}: unaffected sibling rejected`, { cause: siblingOutcome.reason });
    validate(siblingOutcome.value);
}
function observe(promise) {
    return Promise.resolve(promise).then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
}
async function within(promise, watchdogMs, message) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), watchdogMs); }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
//# sourceMappingURL=conformance.js.map