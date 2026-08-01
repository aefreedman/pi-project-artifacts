import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package exposes one canonical Pi extension, two package-owned skills, and side-effect-free contracts/core", () => {
  assert.deepEqual(manifest.pi.extensions, ["./dist/pi/index.js"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.dependencies["@aefree/pi-capability-registry"], "^0.1.0");
  assert.equal(manifest.bundledDependencies, undefined, "the shared kernel is co-installed instead of copied into nested provider tarballs");
  assert.equal(JSON.stringify(manifest).includes("file:../"), false);
  for (const resource of [
    "skills/grooming-project-artifacts/SKILL.md",
    "skills/file-todos/SKILL.md",
    "skills/file-todos/assets/todo-template.md",
    "skills/file-todos/references/commands.md",
    "skills/file-todos/references/dependencies.md",
    "skills/file-todos/references/integration.md",
    "skills/file-todos/references/triage.md",
    "skills/file-todos/references/work-logs.md",
  ]) assert(existsSync(new URL(`../${resource}`, import.meta.url)), `Missing packaged skill resource: ${resource}`);
  assert.deepEqual(Object.keys(manifest.exports).sort(), [".", "./contracts", "./contracts/v1", "./contracts/v1/conformance", "./core", "./pi"]);
});

test("importing contract/core public modules does not register Pi resources", () => {
  const script = `
    const before = new Set(Reflect.ownKeys(globalThis));
    await import('./dist/index.js');
    await import('./dist/contracts/index.js');
    await import('./dist/contracts/v1/index.js');
    await import('./dist/contracts/v1/conformance.js');
    await import('./dist/core/index.js');
    const allowed = new Set([
      Symbol.for('@aefree/pi-project-artifacts/profiles/v1'),
      Symbol.for('@aefree/pi-project-artifacts/search-services/v1'),
      Symbol.for('@aefree/pi-project-artifacts/todo-lifecycle-services/v1'),
    ]);
    const unexpected = Reflect.ownKeys(globalThis).filter((key) => !before.has(key) && !allowed.has(key));
    if (unexpected.length) throw new Error('unexpected globals: ' + unexpected.map(String).join(','));
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", script], { cwd: new URL("..", import.meta.url), stdio: "pipe" });
});
