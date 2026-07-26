import { executeTodoLifecycle } from "../../dist/core/index.js";

const root = process.argv[2];
const point = process.argv[3];
if (!root || !point) throw new Error("usage: todo-transition-child <root> <failure-point>");
const context = { cwd: root, signal: new AbortController().signal };
const listed = await executeTodoLifecycle(context, { operation: "list", workspaceRoot: root });
if (listed.outcome !== "listed" || listed.todos.length !== 1) throw new Error("expected one fixture todo");
await executeTodoLifecycle(context, {
  operation: "transition",
  workspaceRoot: root,
  path: listed.todos[0].path,
  toStatus: "complete",
  expectedContentHash: listed.todos[0].contentHash,
}, {
  failureInjector(current) {
    if (current === point) process.kill(process.pid, "SIGKILL");
  },
});
throw new Error("child was expected to be killed");
