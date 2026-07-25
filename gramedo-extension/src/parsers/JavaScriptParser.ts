// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — JavaScript / TypeScript Parser
// Uses the TypeScript Compiler API for precise, full-fidelity AST parsing.
// Handles .js, .jsx, .ts, .tsx, .mjs, .cjs, .mts, .cts
// ─────────────────────────────────────────────────────────────────────────────

import * as ts from 'typescript';
import { ParseResult, GraphNode, GraphEdge, NodeType, EdgeType } from '../graph/types';
import { IParser } from './IParser';

export class JavaScriptParser implements IParser {
    private edgeCounter = 0;

    private newEdgeId(): string {
        return `edge_${String(++this.edgeCounter).padStart(6, '0')}`;
    }

    async parse(filePath: string, source: string, language: string): Promise<ParseResult> {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        const scriptKind = this.getScriptKind(filePath);
        const sourceFile = ts.createSourceFile(
            filePath,
            source,
            ts.ScriptTarget.Latest,
            /*setParentNodes*/ true,
            scriptKind
        );

        const makeId = (...parts: string[]): string =>
            [filePath, ...parts].filter(Boolean).join('::');

        const getLine = (node: ts.Node): number =>
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false)).line + 1;

        const getEndLine = (node: ts.Node): number =>
            sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

        const getVisibility = (mods?: ts.NodeArray<ts.ModifierLike>): string => {
            if (!mods) { return 'public'; }
            for (const m of mods) {
                if (m.kind === ts.SyntaxKind.PrivateKeyword)   { return 'private'; }
                if (m.kind === ts.SyntaxKind.ProtectedKeyword) { return 'protected'; }
                if (m.kind === ts.SyntaxKind.PublicKeyword)    { return 'public'; }
            }
            return 'public';
        };

        const isStatic = (mods?: ts.NodeArray<ts.ModifierLike>): boolean =>
            mods?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) ?? false;

        const isAbstract = (mods?: ts.NodeArray<ts.ModifierLike>): boolean =>
            mods?.some(m => m.kind === ts.SyntaxKind.AbstractKeyword) ?? false;

        const getJsDoc = (node: ts.Node): string | null => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const jsDocArr = (node as any).jsDoc as ts.JSDoc[] | undefined;
            return jsDocArr?.[0]?.getText(sourceFile) ?? null;
        };

        const getParamSignature = (params: ts.NodeArray<ts.ParameterDeclaration>): string =>
            params.map(p => p.getText(sourceFile)).join(', ');

        // ─── Class visitor ────────────────────────────────────────────────
        const visitClass = (
            node: ts.ClassDeclaration | ts.ClassExpression,
            outerName?: string
        ) => {
            const name = node.name?.text ?? 'AnonymousClass';
            const id = outerName ? makeId(outerName, name) : makeId(name);
            const mods = node.modifiers as ts.NodeArray<ts.ModifierLike> | undefined;

            const classNode: GraphNode = {
                id,
                name,
                type: isAbstract(mods) ? NodeType.AbstractClass : NodeType.Class,
                language,
                file_path: filePath,
                line_start: getLine(node),
                line_end: getEndLine(node),
                visibility: getVisibility(mods),
                is_static: false,
                doc_comment: getJsDoc(node),
                signature: null,
            };
            nodes.push(classNode);

            // Heritage: extends / implements
            if (node.heritageClauses) {
                for (const clause of node.heritageClauses) {
                    const edgeType = clause.token === ts.SyntaxKind.ExtendsKeyword
                        ? EdgeType.INHERITS
                        : EdgeType.IMPLEMENTS;
                    for (const h of clause.types) {
                        const targetName = h.expression.getText(sourceFile);
                        edges.push({
                            id: this.newEdgeId(),
                            type: edgeType,
                            source: id,
                            target: targetName,
                            metadata: { unresolved_target: targetName },
                        });
                    }
                }
            }

            // Members
            for (const member of node.members) {
                if (ts.isConstructorDeclaration(member)) {
                    const ctorId = makeId(name, 'constructor');
                    const sig = `constructor(${getParamSignature(member.parameters)})`;
                    nodes.push({
                        id: ctorId,
                        name: 'constructor',
                        type: NodeType.Constructor,
                        language,
                        file_path: filePath,
                        line_start: getLine(member),
                        line_end: getEndLine(member),
                        visibility: getVisibility(member.modifiers),
                        is_static: false,
                        doc_comment: getJsDoc(member),
                        signature: sig,
                        parent_id: id,
                    });
                    edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_CONSTRUCTOR, source: id, target: ctorId, metadata: {} });
                    if (member.body) { visitCallsIn(member.body, ctorId); }

                } else if (ts.isMethodDeclaration(member)) {
                    const methodName = member.name.getText(sourceFile);
                    const methodId = makeId(name, methodName);
                    const params = getParamSignature(member.parameters);
                    const returnType = member.type?.getText(sourceFile) ?? 'void';
                    nodes.push({
                        id: methodId,
                        name: methodName,
                        type: NodeType.Method,
                        language,
                        file_path: filePath,
                        line_start: getLine(member),
                        line_end: getEndLine(member),
                        visibility: getVisibility(member.modifiers),
                        is_static: isStatic(member.modifiers),
                        doc_comment: getJsDoc(member),
                        signature: `${methodName}(${params}): ${returnType}`,
                        parent_id: id,
                    });
                    edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_METHOD, source: id, target: methodId, metadata: {} });
                    if (member.body) { visitCallsIn(member.body, methodId); }

                } else if (ts.isPropertyDeclaration(member)) {
                    const propName = member.name.getText(sourceFile);
                    const propId = makeId(name, propName);
                    const propType = member.type?.getText(sourceFile) ?? 'any';
                    nodes.push({
                        id: propId,
                        name: propName,
                        type: NodeType.Field,
                        language,
                        file_path: filePath,
                        line_start: getLine(member),
                        line_end: getEndLine(member),
                        visibility: getVisibility(member.modifiers),
                        is_static: isStatic(member.modifiers),
                        doc_comment: getJsDoc(member),
                        signature: `${propName}: ${propType}`,
                        parent_id: id,
                    });
                    edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_FIELD, source: id, target: propId, metadata: {} });
                }
            }
        };

        // ─── Interface visitor ────────────────────────────────────────────
        const visitInterface = (node: ts.InterfaceDeclaration) => {
            const name = node.name.text;
            const id = makeId(name);
            const mods = node.modifiers as ts.NodeArray<ts.ModifierLike> | undefined;

            nodes.push({
                id,
                name,
                type: NodeType.Interface,
                language,
                file_path: filePath,
                line_start: getLine(node),
                line_end: getEndLine(node),
                visibility: getVisibility(mods),
                is_static: false,
                doc_comment: getJsDoc(node),
                signature: null,
            });

            if (node.heritageClauses) {
                for (const clause of node.heritageClauses) {
                    for (const h of clause.types) {
                        const targetName = h.expression.getText(sourceFile);
                        edges.push({
                            id: this.newEdgeId(),
                            type: EdgeType.INHERITS,
                            source: id,
                            target: targetName,
                            metadata: { unresolved_target: targetName },
                        });
                    }
                }
            }

            for (const member of node.members) {
                if (ts.isMethodSignature(member)) {
                    const methodName = member.name.getText(sourceFile);
                    const methodId = makeId(name, methodName);
                    nodes.push({
                        id: methodId,
                        name: methodName,
                        type: NodeType.Method,
                        language,
                        file_path: filePath,
                        line_start: getLine(member),
                        line_end: getEndLine(member),
                        visibility: 'public',
                        is_static: false,
                        doc_comment: getJsDoc(member),
                        signature: `${methodName}(${getParamSignature(member.parameters)})`,
                        parent_id: id,
                    });
                    edges.push({ id: this.newEdgeId(), type: EdgeType.HAS_METHOD, source: id, target: methodId, metadata: {} });
                }
            }
        };

        // ─── Function visitor ─────────────────────────────────────────────
        const visitFunction = (
            node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
            name: string
        ) => {
            const id = makeId(name);
            nodes.push({
                id,
                name,
                type: NodeType.Function,
                language,
                file_path: filePath,
                line_start: getLine(node),
                line_end: getEndLine(node),
                visibility: 'public',
                is_static: false,
                doc_comment: getJsDoc(node),
                signature: `${name}(${getParamSignature(node.parameters)})`,
            });
            const body = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)
                ? node.body
                : ts.isBlock(node.body) ? node.body : undefined;
            if (body) { visitCallsIn(body, id); }
        };

        // ─── Call expression visitor ──────────────────────────────────────
        const visitCallsIn = (node: ts.Node, callerId: string) => {
            const walk = (n: ts.Node) => {
                if (ts.isCallExpression(n)) {
                    const callTarget = n.expression.getText(sourceFile);
                    const line = getLine(n);
                    edges.push({
                        id: this.newEdgeId(),
                        type: EdgeType.CALLS,
                        source: callerId,
                        target: callTarget,
                        metadata: { line, is_conditional: false, is_recursive: false, unresolved_target: callTarget },
                    });
                }
                ts.forEachChild(n, walk);
            };
            ts.forEachChild(node, walk);
        };

        // ─── Enum visitor ─────────────────────────────────────────────────
        const visitEnum = (node: ts.EnumDeclaration) => {
            const name = node.name.text;
            const mods = node.modifiers as ts.NodeArray<ts.ModifierLike> | undefined;
            nodes.push({
                id: makeId(name),
                name,
                type: NodeType.Enum,
                language,
                file_path: filePath,
                line_start: getLine(node),
                line_end: getEndLine(node),
                visibility: getVisibility(mods),
                is_static: false,
                doc_comment: getJsDoc(node),
                signature: null,
            });
        };

        // ─── Top-level walk ───────────────────────────────────────────────
        const visit = (node: ts.Node) => {
            if (ts.isClassDeclaration(node)) {
                visitClass(node);
            } else if (ts.isClassExpression(node)) {
                visitClass(node);
            } else if (ts.isInterfaceDeclaration(node)) {
                visitInterface(node);
            } else if (ts.isEnumDeclaration(node)) {
                visitEnum(node);
            } else if (ts.isFunctionDeclaration(node) && node.name) {
                visitFunction(node, node.name.text);
            } else if (ts.isVariableStatement(node)) {
                // const foo = () => {} or const foo = function() {}
                for (const decl of node.declarationList.declarations) {
                    if (!ts.isIdentifier(decl.name)) { continue; }
                    const varName = decl.name.text;
                    if (decl.initializer) {
                        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
                            visitFunction(decl.initializer, varName);
                        } else {
                            ts.forEachChild(decl.initializer, visit);
                        }
                    }
                }
            } else {
                ts.forEachChild(node, visit);
            }
        };

        ts.forEachChild(sourceFile, visit);

        return { nodes, edges, filePath, language };
    }

    private getScriptKind(filePath: string): ts.ScriptKind {
        const lower = filePath.toLowerCase();
        if (lower.endsWith('.tsx')) { return ts.ScriptKind.TSX; }
        if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')) { return ts.ScriptKind.TS; }
        if (lower.endsWith('.jsx')) { return ts.ScriptKind.JSX; }
        return ts.ScriptKind.JS;
    }
}
