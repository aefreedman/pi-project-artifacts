export type FailureInjector = (point: string, details?: Readonly<Record<string, unknown>>) => void | Promise<void>;
export declare function withMutationQueue<T>(key: string, task: () => Promise<T>): Promise<T>;
export type DirectoryLockOptions = {
    timeoutMs?: number;
    staleMs?: number;
    retryMs?: number;
    signal?: AbortSignal;
    /** Existing physical root that must contain the lock and every quarantine path. */
    physicalRoot?: string;
};
export declare function acquireDirectoryLock(lockPath: string, owner: Readonly<Record<string, unknown>>, options?: DirectoryLockOptions): Promise<() => Promise<void>>;
export declare function withDirectoryLock<T>(lockPath: string, owner: Readonly<Record<string, unknown>>, task: () => Promise<T>, options?: DirectoryLockOptions): Promise<T>;
export declare function exclusiveWrite(target: string, content: string | Uint8Array): Promise<void>;
export declare function atomicReplace(target: string, content: string | Uint8Array, options?: {
    failureInjector?: FailureInjector;
    validatedExisting?: boolean;
}): Promise<void>;
export declare function removeIfMatches(target: string, expected: Uint8Array | string): Promise<boolean>;
export declare function writeJsonAtomic(target: string, value: unknown, validatedExisting: boolean, failureInjector?: FailureInjector): Promise<void>;
export declare function fsyncDirectory(directory: string): Promise<void>;
export declare function cleanupOwnedOrphanTemps(indexPath: string, staleMs?: number): Promise<string[]>;
