import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Type } from "typebox";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const runtimeManifest = JSON.parse(await readFile(new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"));
const contentText = event => event.result.content.filter(block => block.type === "text").map(block => block.text).join(" ");
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

test("actual Pi host: eight adapters, typed codemode, nested outcome, failures, hooks and event/transcript separation", { timeout: 60000 }, async () => {
  assert.equal(runtimeManifest.version, "1.1.0");
  const root = await mkdtemp(path.join(tmpdir(), "artifacts-host-"));
  let session;
  try {
    await mkdir(path.join(root, "docs")); await mkdir(path.join(root, "todos"));
    await writeFile(path.join(root, "docs", "note.md"), "---\nflag: false\n---\n# Host Fixture\n");
    const agentDir = path.join(root, "agent"); await mkdir(agentDir);
    const settingsManager = SettingsManager.inMemory({ defaultTools: ["+codemode"], compaction: { enabled: false }, retry: { enabled: false } });
    const runtime = await ModelRuntime.create({ authPath: path.join(agentDir, "auth.json"), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
    const queue = [];
    let providerRequests = 0, hookMode = "none";
    const nestedOutcomes = [], hostEvents = [];
    const provider = pi => {
      pi.registerProvider("artifact-fixture", {
        api: "artifact-scripted", apiKey: "fixture-not-a-secret", baseUrl: "http://fixture.invalid",
        models: [{ id: "scripted", name: "Local scripted fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
        streamSimple(model, context, options) {
          const stream = new AssistantMessageEventStream();
          void (async () => {
            providerRequests++;
            const content = queue.shift();
            if (!content) throw new Error("Unexpected fixture provider request");
            await options?.onPayload?.({ fixture: true }, model);
            await options?.onResponse?.(new Response("", { status: 200 }), model);
            const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], usage: structuredClone(usage), stopReason: "pending", timestamp: Date.now() };
            stream.push({ type: "start", partial: message });
            message.content = content;
            for (let index = 0; index < content.length; index++) {
              const block = content[index];
              if (block.type === "toolCall") {
                stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
                stream.push({ type: "toolcall_delta", contentIndex: index, delta: JSON.stringify(block.arguments), partial: message });
                stream.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: message });
              } else {
                stream.push({ type: "text_start", contentIndex: index, partial: message });
                stream.push({ type: "text_delta", contentIndex: index, delta: block.text, partial: message });
                stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: message });
              }
            }
            message.stopReason = content.some(block => block.type === "toolCall") ? "toolUse" : "stop";
            stream.push({ type: "done", reason: message.stopReason, message }); stream.end(message);
          })().catch(error => {
            const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], usage: structuredClone(usage), stopReason: "error", errorMessage: String(error), timestamp: Date.now() };
            stream.push({ type: "error", reason: "error", error: message }); stream.end(message);
          });
          return stream;
        },
      });
      pi.registerTool({
        name: "fixture_nested_consumer", label: "Nested consumer", description: "Fixture nested consumer", parameters: Type.Object({ name: Type.String(), args: Type.Record(Type.String(), Type.Unknown()) }),
        async execute(_id, params, signal, _update, ctx) {
          const outcome = await ctx.executeTool(params.name, params.args, { signal }); nestedOutcomes.push(outcome);
          const native = outcome.result.structuredContent;
          return { content: [{ type: "text", text: JSON.stringify({ wrapperIsError: outcome.isError, nativeOk: native?.ok, rows: native?.completeness?.rows }) }], details: {} };
        },
      });
      pi.on("tool_call", event => { if (hookMode === "block" && event.toolName === "project_todo_list") return { block: true, reason: "Fixture blocked" }; });
      pi.on("tool_result", event => {
        if (event.toolName === "project_todo_list" && hookMode === "drop") return { content: [{ type: "text", text: "Fixture redacted" }] };
        if (event.toolName === "project_todo_list" && hookMode === "alter") return { structuredContent: { fixtureChangedByHook: true } };
      });
      pi.on("tool_execution_end", event => hostEvents.push(JSON.parse(JSON.stringify(event))));
    };
    const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, noExtensions: true, additionalExtensionPaths: [fileURLToPath(new URL("../dist/pi/index.js", import.meta.url))], extensionFactories: [provider, createCodemodeExtension({ mode: "on" })] });
    await resourceLoader.reload();
    assert.deepEqual(resourceLoader.getExtensions().errors, []);
    const created = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, resourceLoader, settingsManager, sessionManager: SessionManager.inMemory(root), noTools: "builtin" });
    session = created.session;
    await session.bindExtensions({});
    const model = runtime.getModel("artifact-fixture", "scripted"); assert(model);
    await session.setModel(model);
    session.setActiveToolsByName([...session.getActiveToolNames(), "codemode"]);
    const sdkEvents = [];
    session.subscribe(event => sdkEvents.push(JSON.parse(JSON.stringify(event))));
    let serial = 0;
    async function call(name, args = {}) {
      const id = `fixture-${++serial}`;
      queue.push([{ type: "toolCall", id, name, arguments: args }], [{ type: "text", text: "Fixture done" }]);
      await session.prompt("Execute the deterministic fixture step.");
      assert.equal(queue.length, 0);
      const event = sdkEvents.find(event => event.type === "tool_execution_end" && event.toolCallId === id);
      assert(event, JSON.stringify(sdkEvents.slice(-8)));
      return event;
    }
    const directSearch = await call("project_artifact_search", { freshnessMode: "strict" });
    assert.equal(directSearch.result.structuredContent.ok, true); assert.match(directSearch.result.content[0].text, /docs\/note.md/);
    const described = await call("project_artifact_describe"); assert.match(described.result.content[0].text, /flag \(1\)/);
    const allocated = await call("project_todo_allocate"); assert.equal(allocated.result.structuredContent.data.reservation, false);
    const createdTodo = await call("project_todo_create", { title: "Host task", priority: "p2", body: "Body", expectedDirectoryHash: allocated.result.structuredContent.data.directoryHash });
    const todo = createdTodo.result.structuredContent.data.todo;
    const inspected = await call("project_todo_inspect", { path: todo.path }); assert.equal(inspected.result.structuredContent.data.todo.contentHash, todo.contentHash);
    for (const name of ["project_todo_validate", "project_todo_list"]) assert.equal((await call(name)).result.structuredContent.ok, true);
    const transitioned = await call("project_todo_transition", { path: todo.path, toStatus: "complete", expectedContentHash: todo.contentHash }); assert.equal(transitioned.result.structuredContent.data.previousPath, todo.path);
    const selective = await call("codemode", { code: 'const result = await tools.project_todo_list({}); if (!result.ok) throw new Error(result.error.code); return {paths: result.data.todos.map(todo => todo.path), completeness: result.completeness.rows};' });
    assert.equal(selective.isError, false); assert.match(contentText(selective), /001-complete-p2-host-task.md/); assert.equal(contentText(selective).includes("contentHash"), false);
    const nested = await call("fixture_nested_consumer", { name: "project_todo_list", args: {} });
    assert.equal(nestedOutcomes.at(-1).result.structuredContent.ok, true); assert.equal(nestedOutcomes.at(-1).isError, false); assert.match(nested.result.content[0].text, /nativeOk/);
    await writeFile(path.join(root, "todos", "bad.md"), "bad");
    const failure = await call("project_todo_allocate"); assert.equal(failure.isError, true); assert.equal(failure.result.structuredContent.ok, false);
    const resolvedFailure = await call("codemode", { code: 'const result = await tools.project_todo_allocate({}); return {ok: result.ok, code: result.error.code, effects: result.effects.documentEffects};' });
    assert.equal(resolvedFailure.isError, false); assert.match(contentText(resolvedFailure), /preexisting_todo_conflict/);
    await call("fixture_nested_consumer", { name: "project_todo_allocate", args: {} }); assert.equal(nestedOutcomes.at(-1).isError, true); assert.equal(nestedOutcomes.at(-1).result.structuredContent.ok, false);
    const noDto = await call("codemode", { code: 'try { await tools.project_todo_transition({}); throw new Error("should reject"); } catch (error) { return {rejected: !String(error).includes("should reject")}; }' });
    assert.match(contentText(noDto), /"rejected":true/);
    hookMode = "block";
    const blocked = await call("codemode", { code: 'try { await tools.project_todo_list({}); } catch (error) { return {blocked: String(error).includes("Fixture blocked")}; }' }); assert.match(contentText(blocked), /"blocked":true/);
    hookMode = "drop";
    const dropped = await call("codemode", { code: 'const result = await tools.project_todo_list({}); return {value: result, noDTO: typeof result === "string"};' }); assert.match(contentText(dropped), /Fixture redacted/); assert.match(contentText(dropped), /"noDTO":true/);
    hookMode = "alter";
    const altered = await call("codemode", { code: 'return await tools.project_todo_list({});' }); assert.match(contentText(altered), /fixtureChangedByHook/);
    hookMode = "none";
    assert(hostEvents.some(event => event.parentToolCallId && event.toolName === "project_todo_list"));
    assert(sdkEvents.some(event => event.type === "tool_execution_end" && event.result.structuredContent?.operation === "project_todo_allocate" && event.isError));
    const transcript = session.messages.filter(message => message.role === "toolResult");
    assert(transcript.every(message => message.structuredContent === undefined));
    assert(transcript.every(message => JSON.stringify(message.details).includes('"schema":"@aefree/pi-project-artifacts/tool-output"') === false));
    assert.equal(transcript.some(message => message.toolCallId === nestedOutcomes[0].toolCall.id), false);
    assert.equal(providerRequests, serial * 2);
    console.log(`Pi ${runtimeManifest.version}; ${serial} scripted host steps; final SDK events JSON serialized; no RPC/CLI wire claim.`);
  } finally { session?.dispose(); await rm(root, { recursive: true, force: true }); }
});
