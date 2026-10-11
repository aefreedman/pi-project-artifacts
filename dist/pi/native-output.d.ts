type RecordValue = Record<string, any>;
type SampleDisclosure = {
    samples: boolean;
    fieldNames: readonly string[];
};
export type NativeExecution = {
    native: unknown;
    text: string;
    details: RecordValue;
};
/** Single canonical execution, then allowlisted validation. Hooks remain Pi-owned. */
export declare function nativeToolResult(name: string, execute: () => Promise<NativeExecution>, preconditions?: RecordValue, disclosure?: SampleDisclosure): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    details: {};
    structuredContent: RecordValue;
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    details: RecordValue | {
        presentationDetailsOmitted: boolean;
        resultCount: any;
        returnedResultCount: any;
        cacheState: any;
        fields: never[];
        fieldDefinitionCount: number;
        observedFieldCatalog: {
            fields: never[];
            totalFieldCount: any;
        };
        result: {
            outcome: any;
            summary: string;
            todo: any;
            renderedId: any;
            todos: never[];
            issues: never[];
            todosTotal: number;
            issuesTotal: number;
        };
    };
    structuredContent: RecordValue;
    isError?: boolean;
}>;
export {};
