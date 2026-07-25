// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Java Parser (tree-sitter-java)
// ─────────────────────────────────────────────────────────────────────────────

import { ParseResult, GraphNode, GraphEdge, NodeType, EdgeType } from '../graph/types';
import { TreeSitterParser } from './TreeSitterParser';

// ── Tree-sitter queries ───────────────────────────────────────────────────────

/** Matches top-level and nested class/interface/enum declarations */
const DECL_QUERY = `
(class_declaration
  (modifiers)? @modifiers
  name: (identifier) @class.name) @class

(interface_declaration
  (modifiers)? @modifiers
  name: (identifier) @interface.name) @interface

(enum_declaration
  (modifiers)? @modifiers
  name: (identifier) @enum.name) @enum
`;

const HERITAGE_QUERY = `
(class_declaration
  name: (identifier) @owner
  (superclass (type_identifier) @superclass))

(class_declaration
  name: (identifier) @owner
  (super_interfaces
    (interface_type_list
      (interface_type (type_identifier) @iface))))

(interface_declaration
  name: (identifier) @owner
  (extends_interfaces
    (interface_type_list
      (interface_type (type_identifier) @iface))))
`;

const METHOD_QUERY = `
(method_declaration
  (modifiers)? @modifiers
  type: (_) @return_type
  name: (identifier) @method.name
  parameters: (formal_parameters) @params) @method
`;

const CONSTRUCTOR_QUERY = `
(constructor_declaration
  (modifiers)? @modifiers
  name: (identifier) @ctor.name
  parameters: (formal_parameters) @params) @ctor
`;

const FIELD_QUERY = `
(field_declaration
  (modifiers)? @modifiers
  type: (_) @field_type
  declarator: (variable_declarator
    name: (identifier) @field.name)) @field
`;

const CALL_QUERY = `
(method_invocation
  name: (identifier) @call.name) @call
`;

// ─────────────────────────────────────────────────────────────────────────────

export class JavaParser extends TreeSitterParser {
    constructor(wasmDir: string) {
        super(wasmDir, 'tree-sitter-java.wasm');
    }

    async parse(filePath: string, source: string, language: string): Promise<ParseResult> {
        if (!this.parserInstance) { await this.init(); }

        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const tree = this.parseSource(source);
        const lang = this.getLanguage();

        // ── Class / Interface / Enum declarations ─────────────────────────
        const declMatches = this.query(lang, DECL_QUERY, tree);
        const classNodeMap = new Map<string, GraphNode>(); // name → node

        for (const match of declMatches) {
            const c = this.captureMap(match);

            let nodeType: NodeType;
            let name: string;

            if (c['class.name']) {
                nodeType = NodeType.Class;
                name = c['class.name'].text;
            } else if (c['interface.name']) {
                nodeType = NodeType.Interface;
                name = c['interface.name'].text;
            } else if (c['enum.name']) {
                nodeType = NodeType.Enum;
                name = c['enum.name'].text;
            } else {
                continue;
            }

            const containerNode = c['class'] ?? c['interface'] ?? c['enum'];
            const node: GraphNode = {
                id: this.makeNodeId(filePath, name),
                name,
                type: nodeType,
                language,
                file_path: filePath,
                line_start: (c['class.name'] ?? c['interface.name'] ?? c['enum.name']).startPosition.row + 1,
                line_end: containerNode?.endPosition.row ?? 0 + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: this.extractIsStatic(c['modifiers']),
                doc_comment: null,
                signature: null,
            };
            nodes.push(node);
            classNodeMap.set(name, node);
        }

        // ── Heritage (extends / implements) ───────────────────────────────
        const heritageMatches = this.query(lang, HERITAGE_QUERY, tree);
        for (const match of heritageMatches) {
            const c = this.captureMap(match);
            const ownerName = c['owner']?.text;
            if (!ownerName) { continue; }
            const sourceId = this.makeNodeId(filePath, ownerName);

            if (c['superclass']) {
                edges.push({
                    id: this.newEdgeId(),
                    type: EdgeType.INHERITS,
                    source: sourceId,
                    target: c['superclass'].text,
                    metadata: { unresolved_target: c['superclass'].text },
                });
            }
            if (c['iface']) {
                edges.push({
                    id: this.newEdgeId(),
                    type: EdgeType.IMPLEMENTS,
                    source: sourceId,
                    target: c['iface'].text,
                    metadata: { unresolved_target: c['iface'].text },
                });
            }
        }

        // ── Methods ───────────────────────────────────────────────────────
        const methodMatches = this.query(lang, METHOD_QUERY, tree);
        for (const match of methodMatches) {
            const c = this.captureMap(match);
            const methodName = c['method.name']?.text;
            if (!methodName) { continue; }

            // Determine containing class by walking ancestors
            const ownerName = this.findOwnerClass(c['method']);
            const parentNode = ownerName ? classNodeMap.get(ownerName) : undefined;
            const parentId = parentNode?.id;

            const params = c['params']?.text ?? '()';
            const returnType = c['return_type']?.text ?? 'void';
            const id = parentId
                ? this.makeNodeId(filePath, ownerName!, methodName)
                : this.makeNodeId(filePath, methodName);

            const node: GraphNode = {
                id,
                name: methodName,
                type: NodeType.Method,
                language,
                file_path: filePath,
                line_start: c['method.name'].startPosition.row + 1,
                line_end: c['method']?.endPosition.row ?? 0 + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: this.extractIsStatic(c['modifiers']),
                doc_comment: null,
                signature: `${methodName}${params}: ${returnType}`,
                parent_id: parentId,
            };
            nodes.push(node);

            if (parentId) {
                edges.push({
                    id: this.newEdgeId(),
                    type: EdgeType.HAS_METHOD,
                    source: parentId,
                    target: id,
                    metadata: {},
                });
            }
        }

        // ── Constructors ──────────────────────────────────────────────────
        const ctorMatches = this.query(lang, CONSTRUCTOR_QUERY, tree);
        for (const match of ctorMatches) {
            const c = this.captureMap(match);
            const ctorName = c['ctor.name']?.text;
            if (!ctorName) { continue; }

            const ownerName = this.findOwnerClass(c['ctor']);
            const parentId = ownerName ? this.makeNodeId(filePath, ownerName) : undefined;
            const params = c['params']?.text ?? '()';
            const id = parentId
                ? this.makeNodeId(filePath, ctorName, '<init>')
                : this.makeNodeId(filePath, ctorName, '<init>');

            const node: GraphNode = {
                id,
                name: `${ctorName}<init>`,
                type: NodeType.Constructor,
                language,
                file_path: filePath,
                line_start: c['ctor.name'].startPosition.row + 1,
                line_end: c['ctor']?.endPosition.row ?? 0 + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: false,
                doc_comment: null,
                signature: `${ctorName}${params}`,
                parent_id: parentId,
            };
            nodes.push(node);

            if (parentId) {
                edges.push({
                    id: this.newEdgeId(),
                    type: EdgeType.HAS_CONSTRUCTOR,
                    source: parentId,
                    target: id,
                    metadata: {},
                });
            }
        }

        // ── Fields ────────────────────────────────────────────────────────
        const fieldMatches = this.query(lang, FIELD_QUERY, tree);
        for (const match of fieldMatches) {
            const c = this.captureMap(match);
            const fieldName = c['field.name']?.text;
            if (!fieldName) { continue; }

            const ownerName = this.findOwnerClass(c['field']);
            const parentId = ownerName ? this.makeNodeId(filePath, ownerName) : undefined;
            const fieldType = c['field_type']?.text ?? 'unknown';
            const id = parentId
                ? this.makeNodeId(filePath, ownerName!, fieldName)
                : this.makeNodeId(filePath, fieldName);

            const node: GraphNode = {
                id,
                name: fieldName,
                type: NodeType.Field,
                language,
                file_path: filePath,
                line_start: c['field.name'].startPosition.row + 1,
                line_end: c['field']?.endPosition.row ?? 0 + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: this.extractIsStatic(c['modifiers']),
                doc_comment: null,
                signature: `${fieldName}: ${fieldType}`,
                parent_id: parentId,
            };
            nodes.push(node);

            if (parentId) {
                edges.push({
                    id: this.newEdgeId(),
                    type: EdgeType.HAS_FIELD,
                    source: parentId,
                    target: id,
                    metadata: {},
                });
            }
        }

        // ── Method calls ──────────────────────────────────────────────────
        const callMatches = this.query(lang, CALL_QUERY, tree);
        for (const match of callMatches) {
            const c = this.captureMap(match);
            const callName = c['call.name']?.text;
            if (!callName) { continue; }

            // Find the enclosing method as caller
            const callerMethod = this.findEnclosingMethod(c['call']);
            if (!callerMethod) { continue; }

            const ownerClass = this.findOwnerClass(callerMethod);
            const callerId = ownerClass
                ? this.makeNodeId(filePath, ownerClass, callerMethod.text)
                : this.makeNodeId(filePath, callerMethod.text);

            edges.push(this.callEdge(callerId, callName, c['call.name'].startPosition.row + 1));
        }

        return { nodes, edges, filePath, language };
    }

    // ── Helper: walk up the AST to find containing class name ────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private findOwnerClass(node: any): string | undefined {
        let cur = node?.parent;
        while (cur) {
            if (cur.type === 'class_declaration' || cur.type === 'interface_declaration' || cur.type === 'enum_declaration') {
                const nameChild = cur.childForFieldName?.('name') ?? cur.namedChildren?.find((n: any) => n.type === 'identifier');
                return nameChild?.text;
            }
            cur = cur.parent;
        }
        return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private findEnclosingMethod(node: any): any | undefined {
        let cur = node?.parent;
        while (cur) {
            if (cur.type === 'method_declaration' || cur.type === 'constructor_declaration') {
                return cur.childForFieldName?.('name') ?? cur.namedChildren?.find((n: any) => n.type === 'identifier');
            }
            cur = cur.parent;
        }
        return undefined;
    }
}
