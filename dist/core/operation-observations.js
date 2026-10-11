const observations = new WeakMap();
export function newObservations() {
    return { phase: "not_started", documentEffects: "none", cacheEffects: "none", recoveryStarted: 0, recoveryCompleted: 0, rollback: "not_needed", references: [], referenceTotal: 0, recoveryEntries: [] };
}
export function observeReference(observation, reference) {
    observation.referenceTotal++;
    if (observation.references.length < 8)
        observation.references.push(reference);
}
export function attachObservations(value, observation) {
    if (value !== null && (typeof value === "object" || typeof value === "function"))
        observations.set(value, Object.freeze({ ...observation, references: [...observation.references], recoveryEntries: observation.recoveryEntries.map(entry => Object.freeze({ ...entry })) }));
    return value;
}
export function operationObservations(value) {
    return value !== null && typeof value === "object" ? observations.get(value) : undefined;
}
