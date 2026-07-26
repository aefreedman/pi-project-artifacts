import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import * as path from "node:path";
import { ProjectArtifactError, throwIfAborted } from "./errors.js";
import { assertPhysicalContainment, normalizePath } from "./roots.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_MS = 120_000;
const DEFAULT_RETRY_MS = 75;
const QUARANTINE_RENAME_RETRIES = 7;
const MAX_QUARANTINE_BACKOFF_MS = 250;

export type FailureInjector = (point: string, details?: Readonly<Record<string, unknown>>) => void | Promise<void>;

const mutationQueues = new Map<string, Promise<void>>();

export async function withMutationQueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const canonical = process.platform === "win32" ? path.resolve(key).toLowerCase() : path.resolve(key);
  const previous = mutationQueues.get(canonical) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  mutationQueues.set(canonical, tail);
  try {
    await previous.catch(() => undefined);
    return await task();
  } finally {
    release();
    if (mutationQueues.get(canonical) === tail) mutationQueues.delete(canonical);
  }
}

export type DirectoryLockOptions = {
  timeoutMs?: number;
  staleMs?: number;
  retryMs?: number;
  signal?: AbortSignal;
  /** Existing physical root that must contain the lock and every quarantine path. */
  physicalRoot?: string;
};

type OwnedLock = { schema: string; version: number; pid: number; createdAt: string; nonce: string };

export async function acquireDirectoryLock(
  lockPath: string,
  owner: Readonly<Record<string, unknown>>,
  options: DirectoryLockOptions = {},
): Promise<() => Promise<void>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const started = Date.now();
  const nonce = randomUUID();
  const ownedRecord = Object.freeze({ ...owner, nonce });
  let malformedOwnerObservation: string | undefined;
  await revalidateLockPath(options.physicalRoot, lockPath, "lock path");
  await mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    throwIfAborted(options.signal);
    await revalidateLockPath(options.physicalRoot, lockPath, "lock path");
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
      const ownerPath = path.join(lockPath, "owner.json");
      let lockOwner: unknown;
      let lockStats;
      try {
        [lockStats, lockOwner] = await Promise.all([stat(lockPath), readLockOwner(ownerPath)]);
      } catch (readError) {
        if (hasCode(readError, "ENOENT")) {
          if (Date.now() - started > timeoutMs) throw new ProjectArtifactError("lock_owner_missing", `Lock owner metadata is missing: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath) });
          await delay(retryMs, options.signal);
          continue;
        }
        if (readError instanceof SyntaxError) {
          // owner.json is written and fsynced immediately after the exclusive
          // directory claim. A competitor can observe the new file while that
          // first write is in flight; require the same malformed bytes twice
          // before diagnosing a persistent foreign/corrupt lock.
          const malformed = await readFile(ownerPath, "utf8").catch(() => "<unreadable>");
          if (malformedOwnerObservation === malformed) throw new ProjectArtifactError("lock_owner_malformed", `Lock owner metadata is malformed: ${normalizePath(ownerPath)}`, { lockPath: normalizePath(lockPath) });
          malformedOwnerObservation = malformed;
          await delay(retryMs, options.signal);
          continue;
        }
        throw readError;
      }
      malformedOwnerObservation = undefined;
      if (!isOwnedLock(lockOwner)) throw new ProjectArtifactError("lock_owner_incompatible", `Lock is not owned by pi-project-artifacts: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath) });
      const age = Date.now() - lockStats.mtimeMs;
      const pidState = processState(lockOwner.pid);
      // A dead PID is positive ownership evidence and may be quarantined
      // immediately after a hard crash. Unknown PIDs remain protected unless
      // and until the lock is old enough to require an explicit diagnosis.
      if (pidState === "dead") {
        const reclaimed = await quarantineOwnedLock(lockPath, lockOwner, options.physicalRoot, age > staleMs ? "stale" : "dead", retryMs, options.signal);
        if (reclaimed) continue;
      } else if (age > staleMs && pidState === "unknown") {
        throw new ProjectArtifactError("stale_lock_uncertain", `Stale lock ownership cannot be proven safe to remove: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath), pid: lockOwner.pid });
      }
      if (Date.now() - started > timeoutMs) throw new ProjectArtifactError("lock_timeout", `Timed out waiting for lock: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath) });
      await delay(retryMs, options.signal);
      continue;
    }
    const ownerPath = path.join(lockPath, "owner.json");
    try {
      await revalidateLockPath(options.physicalRoot, ownerPath, "lock owner path");
      await exclusiveWrite(ownerPath, `${JSON.stringify(ownedRecord, null, 2)}\n`);
      return async () => {
        const current = await readLockOwner(ownerPath).catch((error) => hasCode(error, "ENOENT") ? undefined : Promise.reject(error));
        if (!isOwnedLock(current) || current.nonce !== nonce) {
          throw new ProjectArtifactError("lock_release_not_owned", `Lock release refused because nonce ownership was lost: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath) });
        }
        const released = await quarantineOwnedLock(lockPath, current, options.physicalRoot, "release", retryMs, options.signal);
        if (!released) throw new ProjectArtifactError("lock_release_raced", `Lock release lost a race: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath) });
      };
    } catch (error) {
      const current = await readLockOwner(ownerPath).catch(() => undefined);
      if (isOwnedLock(current) && current.nonce === nonce) await quarantineOwnedLock(lockPath, current, options.physicalRoot, "failed-acquire", retryMs, options.signal).catch(() => undefined);
      throw error;
    }
  }
}

export async function withDirectoryLock<T>(lockPath: string, owner: Readonly<Record<string, unknown>>, task: () => Promise<T>, options: DirectoryLockOptions = {}): Promise<T> {
  const release = await acquireDirectoryLock(lockPath, owner, options);
  try { return await task(); } finally { await release(); }
}

export async function exclusiveWrite(target: string, content: string | Uint8Array): Promise<void> {
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(target).catch(() => undefined);
    throw error;
  }
  await handle.close();
}

export async function atomicReplace(
  target: string,
  content: string | Uint8Array,
  options: { failureInjector?: FailureInjector; validatedExisting?: boolean } = {},
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomSuffix()}.tmp`);
  try {
    await options.failureInjector?.("before_temp_write", { target });
    await exclusiveWrite(temp, content);
    await options.failureInjector?.("after_temp_fsync", { target, temp });
    if (options.validatedExisting) {
      // Node rename replaces atomically on POSIX and supported Windows filesystems.
      await rename(temp, target);
    } else {
      await copyFile(temp, target, fsConstants.COPYFILE_EXCL);
      await unlink(temp);
    }
    await options.failureInjector?.("after_rename", { target });
    await fsyncDirectory(path.dirname(target));
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}

export async function removeIfMatches(target: string, expected: Uint8Array | string): Promise<boolean> {
  try {
    const current = await readFile(target);
    const expectedBuffer = typeof expected === "string" ? Buffer.from(expected) : Buffer.from(expected);
    if (!current.equals(expectedBuffer)) return false;
    await unlink(target);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return true;
    throw error;
  }
}

export async function writeJsonAtomic(target: string, value: unknown, validatedExisting: boolean, failureInjector?: FailureInjector): Promise<void> {
  await atomicReplace(target, `${JSON.stringify(value, null, 2)}\n`, { validatedExisting, ...(failureInjector === undefined ? {} : { failureInjector }) });
}

export async function fsyncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Windows commonly rejects directory fsync. File fsync plus atomic rename is
    // still used; other failures are surfaced only where the platform supports it.
    if (process.platform !== "win32" && !hasCode(error, "EINVAL") && !hasCode(error, "EPERM")) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function cleanupOwnedOrphanTemps(indexPath: string, staleMs = DEFAULT_STALE_MS): Promise<string[]> {
  const directory = path.dirname(indexPath);
  const prefix = `.${path.basename(indexPath)}.`;
  const removed: string[] = [];
  let entries;
  try { entries = await import("node:fs/promises").then(({ readdir }) => readdir(directory, { withFileTypes: true })); }
  catch (error) { if (hasCode(error, "ENOENT")) return removed; throw error; }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".tmp")) continue;
    const target = path.join(directory, entry.name);
    const targetStats = await stat(target);
    if (Date.now() - targetStats.mtimeMs <= staleMs) continue;
    await unlink(target);
    removed.push(target);
  }
  return removed;
}

async function readLockOwner(ownerPath: string): Promise<unknown> {
  return JSON.parse(await readFile(ownerPath, "utf8")) as unknown;
}

async function quarantineOwnedLock(
  lockPath: string,
  expected: OwnedLock,
  physicalRoot: string | undefined,
  reason: string,
  retryMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const quarantine = `${lockPath}.quarantine-${reason}-${expected.nonce}-${randomUUID()}`;
  const reclaimGuard = `${lockPath}.reclaim`;
  const reclaiming = reason === "stale" || reason === "dead";
  await revalidateLockPath(physicalRoot, lockPath, "lock path");
  await revalidateLockPath(physicalRoot, quarantine, "lock quarantine path");
  if (reclaiming) {
    await revalidateLockPath(physicalRoot, reclaimGuard, "lock reclaim guard");
    try { await mkdir(reclaimGuard); }
    catch (error) { if (hasCode(error, "EEXIST")) return false; throw error; }
  }
  try {
    // A competing observer can hold a directory handle just as this process
    // tries to rename it on Windows. Retry only after re-reading the source
    // nonce: an EPERM/EBUSY is never permission to take over a replacement.
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(signal);
      if (!await lockPathHasExpectedOwner(lockPath, expected)) return false;
      try {
        await rename(lockPath, quarantine);
        break;
      } catch (error) {
        if (hasCode(error, "ENOENT")) return false;
        if (!hasCode(error, "EPERM") && !hasCode(error, "EBUSY")) throw error;
        // Revalidate immediately after the failed rename as well. If it is
        // gone or changed, another actor won and this claimant must not retry.
        if (!await lockPathHasExpectedOwner(lockPath, expected)) return false;
        if (attempt >= QUARANTINE_RENAME_RETRIES) return false;
        await delay(Math.min(Math.max(1, retryMs) * 2 ** attempt, MAX_QUARANTINE_BACKOFF_MS), signal);
      }
    }
    const quarantinedOwner = await readLockOwner(path.join(quarantine, "owner.json")).catch(() => undefined);
    if (!isOwnedLock(quarantinedOwner) || quarantinedOwner.nonce !== expected.nonce) {
      // The renamed directory is not ours. Leave both it and any successor at
      // lockPath untouched: restoring with rename could replace that successor.
      throw new ProjectArtifactError("lock_quarantine_not_owned", `Quarantined lock nonce did not match inspected ownership: ${normalizePath(lockPath)}`, { lockPath: normalizePath(lockPath) });
    }
    await rm(quarantine, { recursive: true, force: true });
    return true;
  } finally {
    if (reclaiming) await rm(reclaimGuard, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function lockPathHasExpectedOwner(lockPath: string, expected: OwnedLock): Promise<boolean> {
  try {
    const current = await readLockOwner(path.join(lockPath, "owner.json"));
    return isOwnedLock(current) && current.nonce === expected.nonce;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function revalidateLockPath(physicalRoot: string | undefined, target: string, label: string): Promise<void> {
  if (physicalRoot !== undefined) await assertPhysicalContainment(physicalRoot, target, label);
}

function isOwnedLock(value: unknown): value is OwnedLock {
  return typeof value === "object" && value !== null
    && (value as { schema?: unknown }).schema === "@aefree/pi-project-artifacts/lock"
    && (value as { version?: unknown }).version === 1
    && Number.isSafeInteger((value as { pid?: unknown }).pid)
    && typeof (value as { createdAt?: unknown }).createdAt === "string"
    && typeof (value as { nonce?: unknown }).nonce === "string"
    && (value as { nonce: string }).nonce.length >= 16;
}
function processState(pid: number): "alive" | "dead" | "unknown" {
  if (pid === process.pid) return "alive";
  try { process.kill(pid, 0); return "alive"; }
  catch (error) {
    if (hasCode(error, "ESRCH")) return "dead";
    return "unknown";
  }
}
function randomSuffix(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function hasCode(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code; }
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new ProjectArtifactError("aborted", "Artifact operation was aborted.")); }, { once: true });
  });
}
