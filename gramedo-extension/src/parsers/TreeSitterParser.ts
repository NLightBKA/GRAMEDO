// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Tree-Sitter Base Parser
// Wraps web-tree-sitter, handles WASM initialization and language loading.
// Subclasses provide language-specific query strings.
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import { ParseResult, GraphNode, GraphEdge, NodeType, EdgeType } from '../graph/types';
import { IParser } from './IParser';

// Lazy-loaded to avoid top-level require issues in VS Code extension host
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Parser: any;

interface TSNode {
    type: string;
    text: string;
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    children: TSNode[];
    childCount: number;
    parent: TSNode | null;
    isNamed: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    childForFieldName(name: string): TSNode | null;
    namedChildren: TSNode[];
}

interface TSQueryCapture {
    name: string;
    node: TSNode;
}

interface TSQueryMatch {
    captures: TSQueryCapture[];
}

export abstract class TreeSitterParser implements IParser {
    /** Singleton: initialized once per process */
    private static _initialized = false;
    /** Cache of loaded language objects by grammar name */
    private static _langCache = new Map<string, unknown>();

    protected parserInstance: unknown = null;
    private wasmDir: string;
    private grammarFileName: string;

    private edgeCounter = 0;

    constructor(wasmDir: string, grammarFileName: string) {
        this.wasmDir = wasmDir;
        this.grammarFileName = grammarFileName;
    }

    /** Initialize web-tree-sitter once and load the language grammar */
    async init(): Promise<void> {
        if (!Parser) {
            // Dynamic require to avoid bundling issues
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            Parser = require('web-tree-sitter');
        }

        if (!TreeSitterParser._initialized) {
            await Parser.init({
                locateFile: (name: string) =>
                    path.join(this.wasmDir, name),
            });
            TreeSitterParser._initialized = true;
        }

        const cacheKey = this.grammarFileName;
        if (!TreeSitterParser._langCache.has(cacheKey)) {
            const wasmPath = path.join(this.wasmDir, this.grammarFileName);
            const lang = await Parser.Language.load(wasmPath);
            TreeSitterParser._langCache.set(cacheKey, lang);
        }

        const p = new Parser();
        p.setLanguage(TreeSitterParser._langCache.get(cacheKey));
        this.parserInstance = p;
    }

    /** Run a tree-sitter query and return all captures. */
    protected query(
        language: unknown,
        queryStr: string,
        tree: unknown
    ): TSQueryMatch[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q = (language as any).query(queryStr);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return q.matches((tree as any).rootNode) as TSQueryMatch[];
    }

    /** Generate a unique edge ID */
    protected newEdgeId(): string {
        return `edge_${String(++this.edgeCounter).padStart(6, '0')}`;
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    protected makeNodeId(filePath: string, ...parts: string[]): string {
        return [filePath, ...parts].join('::');
    }

    protected nodeFromCaptures(
        captures: Record<string, TSNode>,
        filePath: string,
        language: string,
        type: NodeType,
        nameKey: string,
        parentId?: string
    ): GraphNode | null {
        const nameNode = captures[nameKey];
        if (!nameNode) { return null; }

        const containerNode = captures['container'] ?? nameNode.parent;

        return {
            id: parentId
                ? this.makeNodeId(filePath, captures['parent_name']?.text ?? 'unknown', nameNode.text)
                : this.makeNodeId(filePath, nameNode.text),
            name: nameNode.text,
            type,
            language,
            file_path: filePath,
            line_start: nameNode.startPosition.row + 1,
            line_end: (containerNode ?? nameNode).endPosition.row + 1,
            visibility: this.extractVisibility(captures['modifiers']),
            is_static: this.extractIsStatic(captures['modifiers']),
            doc_comment: null,
            signature: null,
            parent_id: parentId,
        };
    }

    protected extractVisibility(modifiersNode: TSNode | undefined): string {
        if (!modifiersNode) { return 'package'; }
        const text = modifiersNode.text;
        if (text.includes('private'))   { return 'private'; }
        if (text.includes('protected')) { return 'protected'; }
        if (text.includes('public'))    { return 'public'; }
        if (text.includes('internal'))  { return 'internal'; }
        return 'package';
    }

    protected extractIsStatic(modifiersNode: TSNode | undefined): boolean {
        return modifiersNode?.text.includes('static') ?? false;
    }

    // ─── Abstract interface ──────────────────────────────────────────────────

    /** Subclasses implement the actual tree-sitter-based extraction logic */
    abstract parse(filePath: string, source: string, language: string): Promise<ParseResult>;

    /** Utility: parse source string and return tree */
    protected parseSource(source: string): unknown {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.parserInstance as any).parse(source);
    }

    /** Get the language object from the parser instance */
    protected getLanguage(): unknown {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this.parserInstance as any).getLanguage();
    }

    /** Helper: extract captures by name from a match */
    protected captureMap(match: TSQueryMatch): Record<string, TSNode> {
        const map: Record<string, TSNode> = {};
        for (const cap of match.captures) {
            map[cap.name] = cap.node;
        }
        return map;
    }

    /** Build a simple CALLS edge from caller id → callee name (unresolved) */
    protected callEdge(
        sourceId: string,
        calleeName: string,
        line: number
    ): GraphEdge {
        return {
            id: this.newEdgeId(),
            type: EdgeType.CALLS,
            source: sourceId,
            target: calleeName,
            metadata: {
                line,
                is_conditional: false,
                is_recursive: false,
                unresolved_target: calleeName,
            },
        };
    }
}
