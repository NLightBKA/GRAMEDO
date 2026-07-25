// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Python Parser (tree-sitter-python)
// ─────────────────────────────────────────────────────────────────────────────

import { ParseResult, GraphNode, GraphEdge, NodeType, EdgeType } from '../graph/types';
import { TreeSitterParser } from './TreeSitterParser';

const CLASS_QUERY = `
(class_definition
  name: (identifier) @class.name
  body: (block) @class.body) @class
`;

const BASE_CLASS_QUERY = `
(class_definition
  name: (identifier) @owner.name
  superclasses: (argument_list
    [(identifier) @base
     (attribute) @base]))
`;

const FUNCTION_QUERY = `
(function_definition
  name: (identifier) @func.name) @func
`;

const CALL_QUERY = `
(call
  function: [(identifier) @call.name
             (attribute attribute: (identifier) @call.name)]) @call
`;

// ─────────────────────────────────────────────────────────────────────────────

export class PythonParser extends TreeSitterParser {
    constructor(wasmDir: string) {
        super(wasmDir, 'tree-sitter-python.wasm');
    }

    async parse(filePath: string, source: string, language: string): Promise<ParseResult> {
        if (!this.parserInstance) { await this.init(); }

        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const tree = this.parseSource(source);
        const lang = this.getLanguage();

        const classMap = new Map<string, GraphNode>();

        // ── Class definitions ─────────────────────────────────────────────
        const classMatches = this.query(lang, CLASS_QUERY, tree);
        for (const match of classMatches) {
            const c = this.captureMap(match);
            const name = c['class.name']?.text;
            if (!name) { continue; }

            const node: GraphNode = {
                id: this.makeNodeId(filePath, name),
                name,
                type: NodeType.Class,
                language,
                file_path: filePath,
                line_start: c['class.name'].startPosition.row + 1,
                line_end: (c['class'] ?? c['class.body'])?.endPosition.row + 1,
                visibility: 'public',
                is_static: false,
                doc_comment: this.extractDocstring(c['class.body']),
                signature: null,
            };
            nodes.push(node);
            classMap.set(name, node);
        }

        // ── Base classes (inheritance) ─────────────────────────────────────
        const baseMatches = this.query(lang, BASE_CLASS_QUERY, tree);
        for (const match of baseMatches) {
            const c = this.captureMap(match);
            const ownerName = c['owner.name']?.text;
            const baseName = c['base']?.text;
            if (!ownerName || !baseName) { continue; }

            const sourceId = this.makeNodeId(filePath, ownerName);
            edges.push({
                id: this.newEdgeId(),
                type: EdgeType.INHERITS,
                source: sourceId,
                target: baseName,
                metadata: { unresolved_target: baseName },
            });
        }

        // ── Functions / Methods ───────────────────────────────────────────
        const funcMatches = this.query(lang, FUNCTION_QUERY, tree);
        for (const match of funcMatches) {
            const c = this.captureMap(match);
            const funcName = c['func.name']?.text;
            if (!funcName) { continue; }

            const ownerName = this.findOwnerClass(c['func']);
            const parentId = ownerName ? this.makeNodeId(filePath, ownerName) : undefined;
            const isMethod = !!ownerName;

            const id = parentId
                ? this.makeNodeId(filePath, ownerName!, funcName)
                : this.makeNodeId(filePath, funcName);

            const isInit = funcName === '__init__';

            const node: GraphNode = {
                id,
                name: funcName,
                type: isInit ? NodeType.Constructor : (isMethod ? NodeType.Method : NodeType.Function),
                language,
                file_path: filePath,
                line_start: c['func.name'].startPosition.row + 1,
                line_end: c['func']?.endPosition.row + 1,
                visibility: funcName.startsWith('__') && !isInit ? 'private' :
                            funcName.startsWith('_') ? 'protected' : 'public',
                is_static: false,
                doc_comment: null,
                signature: funcName,
                parent_id: parentId,
            };
            nodes.push(node);

            if (parentId) {
                edges.push({
                    id: this.newEdgeId(),
                    type: isInit ? EdgeType.HAS_CONSTRUCTOR : EdgeType.HAS_METHOD,
                    source: parentId,
                    target: id,
                    metadata: {},
                });
            }
        }

        // ── Call expressions ──────────────────────────────────────────────
        const callMatches = this.query(lang, CALL_QUERY, tree);
        for (const match of callMatches) {
            const c = this.captureMap(match);
            const callName = c['call.name']?.text;
            if (!callName) { continue; }

            const enclosingFunc = this.findEnclosingFunction(c['call']);
            if (!enclosingFunc) { continue; }

            const ownerClass = this.findOwnerClass(enclosingFunc);
            const callerId = ownerClass
                ? this.makeNodeId(filePath, ownerClass, enclosingFunc.text)
                : this.makeNodeId(filePath, enclosingFunc.text);

            edges.push(this.callEdge(callerId, callName, c['call.name'].startPosition.row + 1));
        }

        return { nodes, edges, filePath, language };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private findOwnerClass(node: any): string | undefined {
        let cur = node?.parent;
        while (cur) {
            if (cur.type === 'class_definition') {
                return cur.namedChildren?.find((n: any) => n.type === 'identifier')?.text;
            }
            cur = cur.parent;
        }
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private findEnclosingFunction(node: any): any | undefined {
        let cur = node?.parent;
        while (cur) {
            if (cur.type === 'function_definition') {
                return cur.namedChildren?.find((n: any) => n.type === 'identifier');
            }
            cur = cur.parent;
        }
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private extractDocstring(bodyNode: any): string | null {
        if (!bodyNode) { return null; }
        const firstStmt = bodyNode.namedChildren?.[0];
        if (firstStmt?.type === 'expression_statement') {
            const expr = firstStmt.namedChildren?.[0];
            if (expr?.type === 'string') {
                return expr.text;
            }
        }
        return null;
    }
}
