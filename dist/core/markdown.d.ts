export type ParsedMarkdown = Readonly<{
    frontmatter: Readonly<Record<string, unknown>>;
    body: string;
    rawFrontmatter?: string;
    frontmatterRange?: Readonly<{
        start: number;
        end: number;
    }>;
    malformed: boolean;
}>;
/** Tolerant, dependency-free frontmatter parser used for indexing and todo identity fields. */
export declare function parseMarkdown(text: string): ParsedMarkdown;
export declare function stringValues(value: unknown): string[];
export declare function extractTitle(body: string, frontmatter: Readonly<Record<string, unknown>>): string | undefined;
export declare function extractHeadings(body: string): string[];
export declare function extractArtifactLinks(body: string): string[];
export declare function replaceTopLevelFrontmatterScalar(text: string, key: string, expected: string, replacement: string): string;
export declare function serializeFrontmatter(metadata: Readonly<Record<string, unknown>>, order?: readonly string[]): string;
//# sourceMappingURL=markdown.d.ts.map