// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — C# Parser (tree-sitter-c-sharp)
// ─────────────────────────────────────────────────────────────────────────────

import { ParseResult, GraphNode, NodeType, EdgeType } from '../graph/types';
import { TreeSitterParser } from './TreeSitterParser';

const DECL_QUERY = `
(class_declaration
  (modifier)? @modifiers
  name: (identifier) @class.name) @class

(interface_declaration
  (modifier)? @modifiers
  name: (identifier) @interface.name) @interface

(enum_declaration
  (modifier)? @modifiers
  name: (identifier) @enum.name) @enum

(struct_declaration
  (modifier)? @modifiers
  name: (identifier) @struct.name) @struct
`;

const HERITAGE_QUERY = `
(class_declaration
  name: (identifier) @owner
  bases: (base_list
    (_
      (identifier) @base)))
`;

const METHOD_QUERY = `
(method_declaration
  (modifier)? @modifiers
  returns: (_) @return_type
  name: (identifier) @method.name
  parameters: (parameter_list) @params) @method
`;

const CONSTRUCTOR_QUERY = `
(constructor_declaration
  (modifier)? @modifiers
  name: (identifier) @ctor.name
  parameters: (parameter_list) @params) @ctor
`;

const FIELD_QUERY = `
(field_declaration
  (modifier)? @modifiers
  type: (_) @field_type
  (variable_declaration
    (variable_declarator
      (identifier) @field.name))) @field
`;

const PROPERTY_QUERY = `
(property_declaration
  (modifier)? @modifiers
  type: (_) @prop_type
  name: (identifier) @prop.name) @prop
`;

const CALL_QUERY = `
(invocation_expression
  function: (member_access_expression
    name: (identifier) @call.name)) @call

(invocation_expression
  function: (identifier) @call.name) @call2
`;

// ─────────────────────────────────────────────────────────────────────────────

export class CSharpParser extends TreeSitterParser {
    constructor(wasmDir: string) {
        super(wasmDir, 'tree-sitter-c_sharp.wasm');
    }

    async parse(filePath: string, source: string, language: string): Promise<ParseResult> {
        if (!this.parserInstance) { await this.init(); }

        const nodes: GraphNode[] = [];
        const edges: any[] = [];
        const tree = this.parseSource(source);
        const lang = this.getLanguage();

        const classMap = new Map<string, string>(); // name → id

        // ── Declarations ──────────────────────────────────────────────────
        const declMatches = this.query(lang, DECL_QUERY, tree);
        for (const match of declMatches) {
            const c = this.captureMap(match);

            let nodeType: NodeType;
            let nameText: string;
            let containerNode: any;

            if (c['class.name'])     { nodeType = NodeType.Class;     nameText = c['class.name'].text;     containerNode = c['class']; }
            else if (c['interface.name']) { nodeType = NodeType.Interface; nameText = c['interface.name'].text; containerNode = c['interface']; }
            else if (c['enum.name'])     { nodeType = NodeType.Enum;      nameText = c['enum.name'].text;      containerNode = c['enum']; }
            else if (c['struct.name'])   { nodeType = NodeType.Struct;    nameText = c['struct.name'].text;    containerNode = c['struct']; }
            else { continue; }

            const id = this.makeNodeId(filePath, nameText);
            classMap.set(nameText, id);

            const nameNode = c['class.name'] ?? c['interface.name'] ?? c['enum.name'] ?? c['struct.name'];
            nodes.push({
                id,
                name: nameText,
                type: nodeType,
                language,
                file_path: filePath,
                line_start: nameNode.startPosition.row + 1,
                line_end: containerNode?.endPosition.row + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: this.extractIsStatic(c['modifiers']),
                doc_comment: null,
                signature: null,
            });
        }

        // ── Heritage ──────────────────────────────────────────────────────
        const heritageMatches = this.query(lang, HERITAGE_QUERY, tree);
        for (const match of heritageMatches) {
            const c = this.captureMap(match);
            const ownerName = c['owner']?.text;
            const baseName = c['base']?.text;
            if (!ownerName || !baseName) { continue; }

            edges.push({
                id: this.newEdgeId(),
                type: EdgeType.INHERITS,
                source: this.makeNodeId(filePath, ownerName),
                target: baseName,
                metadata: { unresolved_target: baseName },
            });
        }

        // ── Methods ───────────────────────────────────────────────────────
        const methodMatches = this.query(lang, METHOD_QUERY, tree);
        for (const match of methodMatches) {
            const c = this.captureMap(match);
            const methodName = c['method.name']?.text;
            if (!methodName) { continue; }

            const ownerName = this.findOwnerClass(c['method']);
            const parentId = ownerName ? this.makeNodeId(filePath, ownerName) : undefined;
            const params = c['params']?.text ?? '()';
            const returnType = c['return_type']?.text ?? 'void';
            const id = parentId
                ? this.makeNodeId(filePath, ownerName!, methodName)
                : this.makeNodeId(filePath, methodName);

            nodes.push({
                id,
                name: methodName,
                type: NodeType.Method,
                language,
                file_path: filePath,
                line_start: c['method.name'].startPosition.row + 1,
                line_end: c['method']?.endPosition.row + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: this.extractIsStatic(c['modifiers']),
                doc_comment: null,
                signature: `${methodName}${params}: ${returnType}`,
                parent_id: parentId,
            });

            if (parentId) {
                edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_METHOD, source: parentId, target: id, metadata: {} });
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
            const id = this.makeNodeId(filePath, ctorName, '.ctor');

            nodes.push({
                id,
                name: `${ctorName}()`,
                type: NodeType.Constructor,
                language,
                file_path: filePath,
                line_start: c['ctor.name'].startPosition.row + 1,
                line_end: c['ctor']?.endPosition.row + 1,
                visibility: this.extractVisibility(c['modifiers']),
                is_static: false,
                doc_comment: null,
                signature: `${ctorName}${params}`,
                parent_id: parentId,
            });

            if (parentId) {
                edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_CONSTRUCTOR, source: parentId, target: id, metadata: {} });
            }
        }

        // ── Fields + Properties ───────────────────────────────────────────
        for (const [queryStr, fieldKey, edgeType] of [
            [FIELD_QUERY,    'field.name', EdgeType.HAS_FIELD],
            [PROPERTY_QUERY, 'prop.name',  EdgeType.HAS_FIELD],
        ] as const) {
            const matches = this.query(lang, queryStr as string, tree);
            for (const match of matches) {
                const c = this.captureMap(match);
                const fieldName = c[fieldKey]?.text;
                if (!fieldName) { continue; }

                const ownerName = this.findOwnerClass(c[fieldKey]);
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
                    line_start: c[fieldKey].startPosition.row + 1,
                    line_end: (c['field'] ?? c['prop'])?.endPosition.row + 1,
                    visibility: this.extractVisibility(c['modifiers']),
                    is_static: this.extractIsStatic(c['modifiers']),
                    doc_comment: null,
                    signature: fieldName,
                    parent_id: parentId,
                });

                if (parentId) {
                    edges.push({ id: this.newEdgeId(), type: edgeType, source: parentId, target: id, metadata: {} });
                }
            }
        }

        // ── Calls ─────────────────────────────────────────────────────────
        const callMatches = this.query(lang, CALL_QUERY, tree);
        for (const match of callMatches) {
            const c = this.captureMap(match);
            const callName = c['call.name']?.text;
            if (!callName) { continue; }

            const enclosingMethod = this.findEnclosingMethod(c['call'] ?? c['call2']);
            if (!enclosingMethod) { continue; }

            const ownerClass = this.findOwnerClass(enclosingMethod);
            const callerId = ownerClass
                ? this.makeNodeId(filePath, ownerClass, enclosingMethod.text)
                : this.makeNodeId(filePath, enclosingMethod.text);

            edges.push(this.callEdge(callerId, callName, c['call.name'].startPosition.row + 1));
        }

        return { nodes, edges, filePath, language };
    }

    private findOwnerClass(node: any): string | undefined {
        let cur = node?.parent;
        while (cur) {
            if (['class_declaration', 'struct_declaration', 'interface_declaration'].includes(cur.type)) {
                return cur.childForFieldName?.('name')?.text
                    ?? cur.namedChildren?.find((n: any) => n.type === 'identifier')?.text;
            }
            cur = cur.parent;
        }
        return undefined;
    }

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
