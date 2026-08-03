import { type ArtifactExecutionContextV1, type TodoIdentityV1, type TodoLifecycleRequestV1, type TodoLifecycleResultV1 } from "../contracts/v1/index.js";
import { type FailureInjector } from "./atomic.js";
export type TodoRuntimeOptions = Readonly<{
    failureInjector?: FailureInjector;
}>;
type TodoIssue = {
    path?: string;
    code: string;
    summary: string;
};
type Inspected = {
    state: "valid" | "invalid" | "conflict";
    todo?: TodoIdentityV1;
    issues: TodoIssue[];
    text?: string;
};
export declare function executeTodoLifecycle(context: ArtifactExecutionContextV1, request: TodoLifecycleRequestV1, options?: TodoRuntimeOptions): Promise<TodoLifecycleResultV1>;
export declare function inspectTodoFile(file: string): Promise<Inspected>;
export {};
