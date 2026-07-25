// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — C/C++ Parser (tree-sitter-cpp)
// ─────────────────────────────────────────────────────────────────────────────

import { ParseResult, GraphNode, NodeType, EdgeType } from '../graph/types';
import { TreeSitterParser } from './TreeSitterParser';

const DECL_QUERY = `
(class_specifier
  name: (type_identifier) @class.name) @class

(struct_specifier
  name: (type_identifier) @struct.name) @struct

(enum_specifier
  name: (type_identifier) @enum.name) @enum
`;

const HERITAGE_QUERY = `
(base_class_clause
  (type_specifier (type_identifier) @base.name))
`;

const FUNCTION_QUERY = `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @func.name)) @func

(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @func.name))) @func2
`;

const METHOD_QUERY = `
(function_definition
  declarator: (function_declarator
    declarator: (qualified_identifier
      scope: (namespace_identifier) @class.scope
      name: (identifier) @method.name))) @method
`;

const FIELD_QUERY = `
(field_declaration
  type: (_) @field_type
  declarator: (field_identifier) @field.name) @field
`;

const CALL_QUERY = `
(call_expression
  function: (identifier) @call.name) @call

(call_expression
  function: (field_expression
    field: (field_identifier) @call.name)) @method_call
`;

// ─────────────────────────────────────────────────────────────────────────────

export class CppParser extends TreeSitterParser {
    constructor(wasmDir: string) {
        super(wasmDir, 'tree-sitter-cpp.wasm');
    }

    async parse(filePath: string, source: string, language: string): Promise<ParseResult> {
        if (!this.parserInstance) { await this.init(); }

        const nodes: GraphNode[] = [];
        const edges: any[] = [];
        const tree = this.parseSource(source);
        const lang = this.getLanguage();

        // ── Class / Struct / Enum ─────────────────────────────────────────
        const declMatches = this.query(lang, DECL_QUERY, tree);
        for (const match of declMatches) {
            const c = this.captureMap(match);
            let name: string;
            let nodeType: NodeType;
            let containerKey: string;

            if      (c['class.name'])  { name = c['class.name'].text;  nodeType = NodeType.Class;  containerKey = 'class'; }
            else if (c['struct.name']) { name = c['struct.name'].text; nodeType = NodeType.Struct; containerKey = 'struct'; }
            else if (c['enum.name'])   { name = c['enum.name'].text;   nodeType = NodeType.Enum;   containerKey = 'enum'; }
            else { continue; }

            const nameNode = c['class.name'] ?? c['struct.name'] ?? c['enum.name'];
            const containerNode = c[containerKey];

            nodes.push({
                id: this.makeNodeId(filePath, name),
                name,
                type: nodeType,
                language,
                file_path: filePath,
                line_start: nameNode.startPosition.row + 1,
                line_end: containerNode?.endPosition.row + 1,
                visibility: 'public',
                is_static: false,
                doc_comment: null,
                signature: null,
            });
        }

        // ── Heritage ──────────────────────────────────────────────────────
        const heritageMatches = this.query(lang, HERITAGE_QUERY, tree);
        for (const match of heritageMatches) {
            const c = this.captureMap(match);
            const baseName = c['base.name']?.text;
            if (!baseName) { continue; }

            // Find the class that has this base clause
            const ownerName = this.findOwnerClass(c['base.name']);
            if (!ownerName) { continue; }

            edges.push({
                id: this.newEdgeId(),
                type: EdgeType.INHERITS,
                source: this.makeNodeId(filePath, ownerName),
                target: baseName,
                metadata: { unresolved_target: baseName },
            });
        }

        // ── Standalone functions ──────────────────────────────────────────
        const funcMatches = this.query(lang, FUNCTION_QUERY, tree);
        for (const match of funcMatches) {
            const c = this.captureMap(match);
            const funcName = c['func.name']?.text;
            if (!funcName) { continue; }

            const id = this.makeNodeId(filePath, funcName);
            const containerNode = c['func'] ?? c['func2'];

            nodes.push({
                id,
                name: funcName,
                type: NodeType.Function,
                language,
                file_path: filePath,
                line_start: c['func.name'].startPosition.row + 1,
                line_end: containerNode?.endPosition.row + 1,
                visibility: 'public',
                is_static: false,
                doc_comment: null,
                signature: funcName,
            });
        }

        // ── Out-of-class method definitions (ClassName::methodName) ───────
        const methodMatches = this.query(lang, METHOD_QUERY, tree);
        for (const match of methodMatches) {
            const c = this.captureMap(match);
            const scope = c['class.scope']?.text;
            const methodName = c['method.name']?.text;
            if (!scope || !methodName) { continue; }

            const parentId = this.makeNodeId(filePath, scope);
            const id = this.makeNodeId(filePath, scope, methodName);

            nodes.push({
                id,
                name: methodName,
                type: NodeType.Method,
                language,
                file_path: filePath,
                line_start: c['method.name'].startPosition.row + 1,
                line_end: c['method']?.endPosition.row + 1,
                visibility: 'public',
                is_static: false,
                doc_comment: null,
                signature: `${scope}::${methodName}`,
                parent_id: parentId,
            });

            edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_METHOD, source: parentId, target: id, metadata: {} });
        }

        // ── Fields ────────────────────────────────────────────────────────
        const fieldMatches = this.query(lang, FIELD_QUERY, tree);
        for (const match of fieldMatches) {
            const c = this.captureMap(match);
            const fieldName = c['field.name']?.text;
            if (!fieldName) { continue; }

            const ownerName = this.findOwnerClass(c['field.name']);
            const parentId = ownerName ? this.makeNodeId(filePath, ownerName) : undefined;
            const id = parentId
                ? this.makeNodeId(filePath, ownerName!, fieldName)
                : this.makeNodeId(filePath, fieldName);

            nodes.push({
                id,
                name: fieldName,
                type: NodeType.Field,
                language,
                file_path: filePath,
                line_start: c['field.name'].startPosition.row + 1,
                line_end: c['field']?.endPosition.row + 1,
                visibility: 'private', // C++ fields default private in classes
                is_static: false,
                doc_comment: null,
                signature: `${c['field_type']?.text ?? '?'} ${fieldName}`,
                parent_id: parentId,
            });

            if (parentId) {
                edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_FIELD, source: parentId, target: id, metadata: {} });
            }
        }

        // ── Calls ─────────────────────────────────────────────────────────
        const callMatches = this.query(lang, CALL_QUERY, tree);
        for (const match of callMatches) {
            const c = this.captureMap(match);
            const callName = c['call.name']?.text;
            if (!callName) { continue; }

            const enclosingFunc = this.findEnclosingFunction(c['call'] ?? c['method_call']);
            if (!enclosingFunc) { continue; }

            const ownerClass = this.findOwnerClass(enclosingFunc);
            const callerId = ownerClass
                ? this.makeNodeId(filePath, ownerClass, enclosingFunc.text)
                : this.makeNodeId(filePath, enclosingFunc.text);

            edges.push(this.callEdge(callerId, callName, c['call.name'].startPosition.row + 1));
        }

        return { nodes, edges, filePath, language };
    }

    private findOwnerClass(node: any): string | undefined {
        let cur = node?.parent;
        while (cur) {
            if (cur.type === 'class_specifier' || cur.type === 'struct_specifier') {
                return cur.namedChildren?.find((n: any) => n.type === 'type_identifier')?.text;
            }
            cur = cur.parent;
        }
        return undefined;
    }

    private findEnclosingFunction(node: any): any | undefined {
        let cur = node?.parent;
        while (cur) {
            if (cur.type === 'function_definition') {
                // Find identifier in function declarator
                const decl = cur.childForFieldName?.('declarator');
                if (decl) {
                    const fd = decl.type === 'function_declarator' ? decl : decl.namedChildren?.find((n: any) => n.type === 'function_declarator');
                    if (fd) {
                        return fd.childForFieldName?.('declarator');
                    }
                }
            }
            cur = cur.parent;
        }
        return undefined;
    }
}
