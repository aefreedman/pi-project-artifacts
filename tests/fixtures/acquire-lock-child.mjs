import { access, appendFile, writeFile } from "node:fs/promises";
import { acquireDirectoryLock } from "../../dist/core/index.js";

const [root, lockPath, output, marker, readyDirectory, startPath] = process.argv.slice(2);
if (readyDirectory !== undefined && startPath !== undefined) {
  await writeFile(`${readyDirectory}/${marker}`, "", { flag: "wx" });
  await waitForStart(startPath);
}
const release = await acquireDirectoryLock(lockPath, {
  schema: "@aefree/pi-project-artifacts/lock",
  version: 1,
  owner: "multiprocess-fixture",
  pid: process.pid,
  createdAt: new Date().toISOString(),
}, { physicalRoot: root, timeoutMs: 5_000, retryMs: 10, staleMs: 1 });
try {
  await appendFile(output, `${marker}\n`);
  await new Promise((resolve) => setTimeout(resolve, 50));
} finally { await release(); }

async function waitForStart(startPath) {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await access(startPath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (Date.now() >= deadline) throw new Error("timed out waiting for contention barrier");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}
