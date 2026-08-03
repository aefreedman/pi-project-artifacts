import { type ArtifactSearchServiceV1, type TodoLifecycleServiceV1 } from "../contracts/v1/index.js";
import { type TodoRuntimeOptions } from "./todo-lifecycle.js";
export declare function createArtifactSearchServiceV1(): ArtifactSearchServiceV1;
export declare function createTodoLifecycleServiceV1(options?: TodoRuntimeOptions): TodoLifecycleServiceV1;
