// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Graph Builder
// Merges ParseResults from all files into one unified, deduplicated graph.
// Performs cross-file reference resolution for CALLS edges.
// ─────────────────────────────────────────────────────────────────────────────

import { GraphNode, GraphEdge, GraphData, GraphStats, ParseResult } from './types';

export class GraphBuilder {
    /**
     * Merge all per-file parse results into a single unified graph.
     */
    static build(projectRoot: string, results: ParseResult[]): GraphData {
        const nodeMap = new Map<string, GraphNode>();
        const edgeMap = new Map<string, GraphEdge>();
        const byLanguage: Record<string, number> = {};

        // ── Collect all nodes (deduplicate by id) ─────────────────────────
        for (const result of results) {
            byLanguage[result.language] = (byLanguage[result.language] ?? 0) + result.nodes.length;

            for (const node of result.nodes) {
                if (!nodeMap.has(node.id)) {
                    nodeMap.set(node.id, node);
                }
            }
        }

        // ── Build name → node lookup for cross-file resolution ────────────
        // Maps short class name → array of matching node ids
        const nameIndex = new Map<string, string[]>();
        for (const node of nodeMap.values()) {
            const existing = nameIndex.get(node.name) ?? [];
            existing.push(node.id);
            nameIndex.set(node.name, existing);
        }

        // ── Collect & resolve edges ───────────────────────────────────────
        for (const result of results) {
            for (const edge of result.edges) {
                // Attempt to resolve unresolved targets
                const resolved = GraphBuilder.resolveTarget(
                    edge.target,
                    edge.metadata?.unresolved_target as string | undefined,
                    nameIndex
                );

                const resolvedEdge: GraphEdge = {
                    ...edge,
                    target: resolved ?? edge.target,
                    metadata: {
                        ...edge.metadata,
                        resolved: resolved !== null,
                    },
                };

                // Deduplicate edges by source+type+target
                const key = `${resolvedEdge.source}|${resolvedEdge.type}|${resolvedEdge.target}`;
                if (!edgeMap.has(key)) {
                    edgeMap.set(key, resolvedEdge);
                }
            }
        }

        const nodes = Array.from(nodeMap.values());
        const edges = Array.from(edgeMap.values());

        const stats: GraphStats = {
            nodes: nodes.length,
            edges: edges.length,
            files: results.length,
            by_language: byLanguage,
        };

        return {
            version: '0.1',
            generated_at: new Date().toISOString(),
            project_root: projectRoot,
            stats,
            nodes,
            edges,
        };
    }

    /**
     * Attempt to resolve an unresolved target name to a full node id.
     * Returns the resolved id, or null if not found.
     */
    private static resolveTarget(
        target: string,
        unresolvedName: string | undefined,
        nameIndex: Map<string, string[]>
    ): string | null {
        const lookupName = unresolvedName ?? target;

        // Try exact short-name lookup
        const candidates = nameIndex.get(lookupName);
        if (candidates && candidates.length === 1) {
            return candidates[0];
        }

        // Multiple candidates: try to match by target being a suffix of a candidate id
        if (candidates && candidates.length > 1) {
            const match = candidates.find(id => id.endsWith(`::${target}`) || id.endsWith(target));
            if (match) { return match; }
            // Return first match as best guess
            return candidates[0];
        }

        return null; // Unresolvable (external dependency)
    }
}
