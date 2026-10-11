/** Invocation-local producer facts. Does not change versioned service result shapes. */
export type RecoveryObservation = {
  source: string; target: string; sourceHash: string; targetHash: string;
  journalState: "prepared" | "target_written" | "source_removed";
  action: "unknown" | "removed_journal" | "removed_source" | "restored_source" | "conflict";
  outcome: "started" | "completed" | "failed";
  currentSourceHash?: string | null; currentTargetHash?: string | null;
};
export type OperationObservations = {
  phase: string;
  documentEffects: "none" | "possible" | "observed" | "unknown";
  cacheEffects: "none" | "possible" | "observed" | "unknown";
  recoveryStarted: number;
  recoveryCompleted: number;
  rollback: "not_needed" | "started" | "completed" | "failed";
  references: string[];
  referenceTotal: number;
  directoryHash?: string;
  todoRootState?: "present" | "missing";
  recoveryEntries: RecoveryObservation[];
};
const observations = new WeakMap<object, Readonly<OperationObservations>>();
export function newObservations(): OperationObservations {
  return { phase: "not_started", documentEffects: "none", cacheEffects: "none", recoveryStarted: 0, recoveryCompleted: 0, rollback: "not_needed", references: [], referenceTotal: 0, recoveryEntries: [] };
}
export function observeReference(observation: OperationObservations, reference: string): void {
  observation.referenceTotal++;
  if (observation.references.length < 8) observation.references.push(reference);
}
export function attachObservations<T>(value: T, observation: OperationObservations): T {
  if (value !== null && (typeof value === "object" || typeof value === "function")) observations.set(value as object, Object.freeze({ ...observation, references: [...observation.references], recoveryEntries: observation.recoveryEntries.map(entry => Object.freeze({ ...entry })) }));
  return value;
}
export function operationObservations(value: unknown): Readonly<OperationObservations> | undefined {
  return value !== null && typeof value === "object" ? observations.get(value) : undefined;
}
