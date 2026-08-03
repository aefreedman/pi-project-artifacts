import { ProjectArtifactError } from "./errors.js";
function parseScalar(raw) {
    const value = raw.trim();
    if (value === "")
        return "";
    if (value === "[]")
        return [];
    if (value === "{}")
        return {};
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    if (value === "null" || value === "~")
        return null;
    if (/^-?\d+(?:\.\d+)?$/u.test(value))
        return Number(value);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        if (value.startsWith('"')) {
            try {
                return JSON.parse(value);
            }
            catch {
                return value.slice(1, -1);
            }
        }
        return value.slice(1, -1).replaceAll("''", "'");
    }
    if (value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1).trim();
        if (inner === "")
            return [];
        return splitInline(inner).map(parseScalar);
    }
    return value;
}
function splitInline(value) {
    const output = [];
    let start = 0;
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if ((char === '"' || char === "'") && (index === 0 || value[index - 1] !== "\\"))
            quote = quote === char ? "" : quote === "" ? char : quote;
        if (char === "," && quote === "") {
            output.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    output.push(value.slice(start).trim());
    return output;
}
/** Tolerant, dependency-free frontmatter parser used for indexing and todo identity fields. */
export function parseMarkdown(text) {
    const delimiter = /^---\r?\n/u.exec(text);
    if (delimiter === null)
        return Object.freeze({ frontmatter: Object.freeze({}), body: text, malformed: false });
    const closing = /\r?\n---(?:\r?\n|$)/gu;
    closing.lastIndex = delimiter[0].length;
    const close = closing.exec(text);
    if (close === null) {
        return Object.freeze({ frontmatter: Object.freeze({}), body: text, malformed: true });
    }
    const rawFrontmatter = text.slice(delimiter[0].length, close.index);
    const end = close.index + close[0].length;
    const frontmatter = {};
    const lines = rawFrontmatter.split(/\r?\n/u);
    let currentListKey;
    let malformed = false;
    for (const line of lines) {
        const item = /^\s+-\s*(.*)$/u.exec(line);
        if (item !== null && currentListKey !== undefined) {
            const list = Array.isArray(frontmatter[currentListKey]) ? frontmatter[currentListKey] : [];
            list.push(parseScalar(item[1]));
            frontmatter[currentListKey] = list;
            continue;
        }
        if (/^\s*(?:#.*)?$/u.test(line))
            continue;
        const key = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/u.exec(line);
        if (key === null) {
            // Nested values not needed for indexing remain represented by their parent;
            // truly unowned lines are diagnosed but never make the document unreadable.
            if (!/^\s+/u.test(line))
                malformed = true;
            continue;
        }
        const value = key[2] ?? "";
        if (value.trim() === "") {
            frontmatter[key[1]] = [];
            currentListKey = key[1];
        }
        else {
            frontmatter[key[1]] = parseScalar(value);
            currentListKey = undefined;
        }
    }
    return Object.freeze({
        frontmatter: Object.freeze(frontmatter),
        body: text.slice(end),
        rawFrontmatter,
        frontmatterRange: Object.freeze({ start: 0, end }),
        malformed,
    });
}
export function stringValues(value) {
    if (value === undefined || value === null)
        return [];
    if (Array.isArray(value))
        return value.flatMap(stringValues);
    return [String(value)];
}
export function extractTitle(body, frontmatter) {
    const fromFrontmatter = frontmatter.title;
    if (typeof fromFrontmatter === "string" && fromFrontmatter.trim() !== "")
        return fromFrontmatter.trim();
    return /^#\s+(.+)$/mu.exec(body)?.[1]?.trim();
}
export function extractHeadings(body) {
    return [...body.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) => match[1].trim()).slice(0, 40);
}
export function extractArtifactLinks(body) {
    const output = new Set();
    for (const expression of [/(?:^|[\s(])((?:docs|todos)\/[A-Za-z0-9_./ -]+?\.md)(?=$|[\s)\]`.,:;])/gimu, /\]\(([^)]+\.md)(?:#[^)]*)?\)/gimu]) {
        for (const match of body.matchAll(expression)) {
            const raw = (match[1] ?? "").trim().replace(/^\.\//u, "");
            const normalized = raw.replaceAll("\\", "/").replace(/^.*?(docs|todos)\//iu, "$1/");
            if (normalized.startsWith("docs/") || normalized.startsWith("todos/"))
                output.add(normalized);
        }
    }
    return [...output].sort();
}
export function replaceTopLevelFrontmatterScalar(text, key, expected, replacement) {
    const parsed = parseMarkdown(text);
    if (parsed.rawFrontmatter === undefined || parsed.frontmatterRange === undefined) {
        throw new ProjectArtifactError("todo_frontmatter_missing", "Todo YAML frontmatter is missing or unterminated.");
    }
    const expression = new RegExp(`^(${escapeRegex(key)}:\\s*)([^\\r\\n#]*?)(\\s*(?:#.*)?)$`, "gmu");
    const matches = [...parsed.rawFrontmatter.matchAll(expression)];
    if (matches.length !== 1)
        throw new ProjectArtifactError("todo_frontmatter_ambiguous", `Todo frontmatter must contain exactly one ${key} field.`);
    const current = matches[0][2].trim().replace(/^['"]|['"]$/gu, "");
    if (current !== expected)
        throw new ProjectArtifactError("todo_frontmatter_conflict", `Todo frontmatter ${key} changed from the expected value.`);
    const nextRaw = parsed.rawFrontmatter.replace(expression, `$1${replacement}$3`);
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    return `---${lineEnding}${nextRaw}${lineEnding}---${lineEnding}${parsed.body}`;
}
export function serializeFrontmatter(metadata, order = []) {
    const keys = [...new Set([...order, ...Object.keys(metadata).sort()])].filter((key) => Object.hasOwn(metadata, key));
    return keys.map((key) => serializeKey(key, metadata[key], 0)).join("\n");
}
function serializeKey(key, value, indent) {
    const prefix = " ".repeat(indent);
    if (!/^[A-Za-z0-9_-]+$/u.test(key))
        throw new ProjectArtifactError("frontmatter_key_invalid", `Frontmatter key cannot be serialized safely: ${key}`);
    if (Array.isArray(value)) {
        if (value.length === 0)
            return `${prefix}${key}: []`;
        if (value.every(isScalar))
            return `${prefix}${key}: [${value.map(serializeScalar).join(", ")}]`;
        return `${prefix}${key}:\n${value.map((entry) => `${prefix}  - ${isScalar(entry) ? serializeScalar(entry) : JSON.stringify(entry)}`).join("\n")}`;
    }
    if (value !== null && typeof value === "object") {
        const record = value;
        return `${prefix}${key}:\n${Object.keys(record).sort().map((child) => serializeKey(child, record[child], indent + 2)).join("\n")}`;
    }
    return `${prefix}${key}: ${serializeScalar(value)}`;
}
function isScalar(value) {
    return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function serializeScalar(value) {
    if (value === null)
        return "null";
    if (typeof value === "number" || typeof value === "boolean")
        return String(value);
    const text = String(value);
    return /^[a-zA-Z0-9_./-]+$/u.test(text) && !/^(?:true|false|null|~|-?\d+(?:\.\d+)?)$/u.test(text) ? text : JSON.stringify(text);
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
