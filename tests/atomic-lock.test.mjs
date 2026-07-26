import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
