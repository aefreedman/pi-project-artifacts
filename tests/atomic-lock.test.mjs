import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { existsSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import test from "node:test";
import { acquireDirectoryLock } from "../dist/core/index.js";

function child(script, args) {
  const processHandle = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stderr = "";
  processHandle.stderr.setEncoding("utf8");
  processHandle.stderr.on("data", (chunk) => { stderr += chunk; });
  return { processHandle, stderr: () => stderr };
}

test("release verifies nonce ownership and refuses a replacement owner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-artifact-lock-release-"));
  try {
    const lockPath = path.join(root, ".pi-project-artifacts", "release.lock");
    const release = await acquireDirectoryLock(lockPath, { schema: "@aefree/pi-project-artifacts/lock", version: 1, owner: "release-fixture", pid: process.pid, createdAt: new Date().toISOString() }, { physicalRoot: root });
    const ownerPath = path.join(lockPath, "owner.json");
    const owner = JSON.parse(await readFile(ownerPath, "utf8"));
    await writeFile(ownerPath, `${JSON.stringify({ ...owner, nonce: "replacement-owner-nonce-0001" })}\n`);
    await assert.rejects(release(), (error) => error.code === "lock_release_not_owned");
    assert.equal(existsSync(lockPath), true, "release must not delete a lock whose nonce changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("multiprocess stale-lock reclaim retries Windows rename contention without taking a successor", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-artifact-lock-race-"));
  try {
    // Do not reuse a just-exited child PID: Windows may recycle it while the
    // contention rounds are still spawning workers.
    const deadPid = findDeadPid();
    const script = fileURLToPath(new URL("./fixtures/acquire-lock-child.mjs", import.meta.url));
    const contenders = ["one", "two", "three", "four"];
    for (let round = 0; round < 8; round += 1) {
      const lockPath = path.join(root, ".pi-project-artifacts", `race-${round}.lock`);
      await mkdir(lockPath, { recursive: true });
      await writeFile(path.join(lockPath, "owner.json"), `${JSON.stringify({
        schema: "@aefree/pi-project-artifacts/lock",
        version: 1,
        owner: "dead-fixture",
        pid: deadPid,
        createdAt: new Date(0).toISOString(),
        nonce: `dead-fixture-nonce-${round.toString().padStart(4, "0")}`,
      })}\n`);
      const output = path.join(root, `owners-${round}.txt`);
      const readyDirectory = path.join(root, `ready-${round}`);
      const startPath = path.join(root, `start-${round}`);
      await mkdir(readyDirectory);
      const children = contenders.map((marker) => child(script, [root, lockPath, output, marker, readyDirectory, startPath]));
      await waitForReady(readyDirectory, contenders.length);
      await writeFile(startPath, "go");
      await Promise.all(children.map(async ({ processHandle, stderr }) => {
        const [code] = await once(processHandle, "exit");
        assert.equal(code, 0, stderr());
      }));
      assert.deepEqual((await readFile(output, "utf8")).trim().split(/\r?\n/u).sort(), [...contenders].sort());
      assert.equal(existsSync(lockPath), false, "nonce owner must quarantine and remove only its own lock on release");
      const parent = path.dirname(lockPath);
      const leftovers = await readdir(parent);
      assert.equal(leftovers.some((name) => name.includes(".quarantine-") || name.endsWith(".reclaim")), false, "owned quarantines and reclaim guards must be removed");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

const lockOwner = (pid = process.pid, nonce = "injected-owner-nonce-0001") => ({
  schema: "@aefree/pi-project-artifacts/lock", version: 1, pid,
  createdAt: new Date().toISOString(), nonce,
});

async function withFilesystemInjection(method, inject, task) {
  const original = fs.promises[method];
  fs.promises[method] = (...args) => inject(original, ...args);
  syncBuiltinESMExports();
  try { return await task(); }
  finally { fs.promises[method] = original; syncBuiltinESMExports(); }
}

function realpathFailure(target, code = "EBADF") {
  return Object.assign(new Error(`${code}: injected realpath failure`), { code, syscall: "realpath", path: target });
}

test("Windows lock validation retries exact-target EBADF with a fresh containment proof", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-lock-proof-"));
  const lockPath = path.join(root, "test.lock");
  let failures = 0;
  try {
    await withFilesystemInjection("realpath", async (original, target) => {
      if (target === lockPath && failures++ === 0) throw realpathFailure(target);
      return original(target);
    }, async () => {
      const release = await acquireDirectoryLock(lockPath, lockOwner(), { physicalRoot: root });
      await release();
    });
    assert.ok(failures > 1, "containment must be reproven rather than bypassed");
    assert.equal(existsSync(lockPath), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows retry refuses escaped replacements and preserves their nonce", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-lock-escape-"));
  const outside = await mkdtemp(path.join(tmpdir(), "pi-lock-outside-"));
  const lockPath = path.join(root, "test.lock");
  const bytes = JSON.stringify(lockOwner());
  try {
    await writeFile(path.join(outside, "owner.json"), bytes);
    let injected = false;
    await withFilesystemInjection("realpath", async (original, target) => {
      if (target === lockPath && !injected) {
        injected = true;
        await fs.promises.symlink(outside, lockPath, "junction");
        throw realpathFailure(target);
      }
      return original(target);
    }, async () => {
      await assert.rejects(acquireDirectoryLock(lockPath, lockOwner(), { physicalRoot: root }), (error) => error.code === "path_escape");
    });
    assert.equal(await readFile(path.join(outside, "owner.json"), "utf8"), bytes);
    assert.equal((await fs.promises.lstat(lockPath)).isSymbolicLink(), true);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("lock validation fails closed on persistent EBADF, other errors, and unavailable ancestry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-lock-unavailable-"));
  const lockPath = path.join(root, "missing", "test.lock");
  try {
    for (const [code, failedPath] of [["EBADF", lockPath], ["EACCES", lockPath], ["EBADF", path.dirname(lockPath)]]) {
      let failures = 0;
      await withFilesystemInjection("realpath", async (original, target) => {
        if (target === failedPath) { failures += 1; throw realpathFailure(target, code); }
        return original(target);
      }, async () => {
        await assert.rejects(acquireDirectoryLock(lockPath, lockOwner(), { physicalRoot: root }), (error) => error.code === "path_unavailable" && error.details.filesystemCode === code);
      });
      assert.equal(failures, process.platform === "win32" && code === "EBADF" && failedPath === lockPath ? 8 : 1);
      assert.equal(existsSync(path.dirname(lockPath)), false, "failed proof must precede mutation");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Windows stale quarantine revalidation cannot reclaim a replacement nonce after EBADF", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-lock-successor-"));
  const lockPath = path.join(root, "test.lock");
  const moved = path.join(root, "competitor-quarantine");
  const successor = JSON.stringify(lockOwner());
  try {
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, "owner.json"), JSON.stringify(lockOwner(findDeadPid(), "stale-fixture-owner-nonce-0001")));
    let observations = 0;
    await withFilesystemInjection("realpath", async (original, target) => {
      if (target === lockPath && ++observations === 3) {
        // The stale owner was inspected, but another reclaimer wins before
        // this contender's quarantine containment check finishes.
        await fs.promises.rename(lockPath, moved);
        await mkdir(lockPath);
        await writeFile(path.join(lockPath, "owner.json"), successor);
        throw realpathFailure(target);
      }
      return original(target);
    }, async () => {
      await assert.rejects(acquireDirectoryLock(lockPath, lockOwner(), { physicalRoot: root, timeoutMs: 100, retryMs: 1 }), (error) => error.code === "lock_timeout");
    });
    assert.equal(await readFile(path.join(lockPath, "owner.json"), "utf8"), successor);
    assert.equal(existsSync(moved), true);
    assert.deepEqual((await readdir(root)).sort(), ["competitor-quarantine", "test.lock"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("quarantine must prove the renamed nonce before removing any directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-lock-quarantine-proof-"));
  const lockPath = path.join(root, "test.lock");
  try {
    const release = await acquireDirectoryLock(lockPath, lockOwner(), { physicalRoot: root });
    let quarantine;
    await withFilesystemInjection("rename", async (original, source, destination) => {
      await original(source, destination);
      quarantine = destination;
      await writeFile(path.join(destination, "owner.json"), JSON.stringify(lockOwner(process.pid, "replacement-quarantine-nonce")));
    }, async () => {
      await assert.rejects(release(), (error) => error.code === "lock_quarantine_not_owned");
    });
    assert.equal(existsSync(quarantine), true, "unproven quarantine must not be deleted");
    assert.equal(JSON.parse(await readFile(path.join(quarantine, "owner.json"), "utf8")).nonce, "replacement-quarantine-nonce");
  } finally { await rm(root, { recursive: true, force: true }); }
});

function findDeadPid() {
  for (let pid = 999_999; pid > 999_900; pid -= 1) {
    try { process.kill(pid, 0); }
    catch (error) { if (error?.code === "ESRCH") return pid; }
  }
  throw new Error("could not find a guaranteed-dead fixture PID");
}

async function waitForReady(directory, expectedCount) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await readdir(directory)).length === expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${expectedCount} lock contenders`);
}
