import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lockfile = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("package exposes one canonical Pi extension, three package-owned skills, and side-effect-free contracts/core", () => {
  assert.deepEqual(manifest.pi.extensions, ["./dist/pi/index.js"]);
  assert.deepEqual(manifest.pi.prompts, ["./prompts"]);
  assert.deepEqual(manifest.pi.skills, ["./skills"]);
  assert.equal(manifest.sideEffects, false);
  assert.equal(manifest.dependencies["@aefree/pi-capability-registry"], "^0.1.0");
  assert.equal(manifest.peerDependencies["@earendil-works/pi-tui"], "*");
  assert.equal(manifest.peerDependenciesMeta["@earendil-works/pi-tui"].optional, true);
  assert.equal(manifest.bundledDependencies, undefined, "the shared kernel is co-installed instead of copied into nested provider tarballs");
  assert.equal(JSON.stringify(manifest).includes("file:../"), false);
  for (const resource of [
    "docs/artifact-profile-providers.md",
    "prompts/memorize.md",
    "evals/memorize/cases.json",
    "evals/memorize/ownership-cases.json",
    "skills/grooming-project-artifacts/SKILL.md",
    "skills/using-project-artifacts/SKILL.md",
    "skills/file-todos/SKILL.md",
    "skills/file-todos/assets/todo-template.md",
    "skills/file-todos/references/commands.md",
    "skills/file-todos/references/dependencies.md",
    "skills/file-todos/references/integration.md",
    "skills/file-todos/references/triage.md",
    "skills/file-todos/references/work-logs.md",
  ]) assert(existsSync(new URL(`../${resource}`, import.meta.url)), `Missing packaged skill resource: ${resource}`);
  assert(manifest.files.includes("docs"), "public provider-development docs must be packed");
  assert.equal(manifest.private, undefined, "release package must not retain the npm publication guard");
  assert.equal(manifest.files.includes("src"), false, "authored source is repository-only; consumers use dist runtime and declarations");
  assert.equal(manifest.files.includes("evals"), false, "behavioral evals are repository-only development assets");
  assert.deepEqual(Object.keys(manifest.exports).sort(), [".", "./contracts", "./contracts/v1", "./contracts/v1/conformance", "./core", "./pi"]);
});

test("consumer docs identify disposable cache data without hiding authoritative Markdown", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /\.pi-project-artifacts\//);
  assert.match(readme, /Do not ignore authoritative `docs\/` or `todos\/` Markdown/);
});

test("runtime dependencies resolve from publishable package sources", () => {
  const registry = lockfile.packages["node_modules/@aefree/pi-capability-registry"];
  assert.equal(registry.version, "0.1.0");
  assert.match(registry.resolved, /^https:\/\/registry\.npmjs\.org\/@aefree\/pi-capability-registry\/-\/pi-capability-registry-0\.1\.0\.tgz$/);
  assert.match(registry.integrity, /^sha512-/);
  assert.notEqual(registry.link, true);
  assert.equal(Object.keys(lockfile.packages).some((key) => key.startsWith("../")), false);
});

test("memorize prompt owns bounded project-artifact capture without compatibility aliases", () => {
  const prompt = readFileSync(new URL("../prompts/memorize.md", import.meta.url), "utf8");
  assert.match(prompt, /Direct `\/memorize` invocation authorizes creation or focused update of one resolved project-learning artifact/);
  assert.match(prompt, /does not alter model, session, or global user memory/);
  assert.match(prompt, /project_artifact_search/);
  assert.match(prompt, /output target must be either the project's `solutions\/` domain[\s\S]*or its `memories\/` domain/);
  assert.match(prompt, /Do not route `\/memorize` output to `plans\/`, `patterns\/`, general documentation, todos, or another artifact class/);
  assert.match(prompt, /root cause, reusable resolution pattern, verification evidence/);
  assert.match(prompt, /ask one narrow destination question/);
  assert.match(prompt, /do not write/);
  assert.doesNotMatch(prompt, /\/compound|compatib(?:ility|le) alias/i);
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
