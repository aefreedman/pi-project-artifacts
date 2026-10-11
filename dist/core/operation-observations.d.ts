/** Invocation-local producer facts. Does not change versioned service result shapes. */
export type RecoveryObservation = {
    source: string;
    target: string;
    sourceHash: string;
    targetHash: string;
    journalState: "prepared" | "target_written" | "source_removed";
    action: "unknown" | "removed_journal" | "removed_source" | "restored_source" | "conflict";
    outcome: "started" | "completed" | "failed";
    currentSourceHash?: string | null;
    currentTargetHash?: string | null;
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
export declare function newObservations(): OperationObservations;
export declare function observeReference(observation: OperationObservations, reference: string): void;
export declare function attachObservations<T>(value: T, observation: OperationObservations): T;
export declare function operationObservations(value: unknown): Readonly<OperationObservations> | undefined;
