// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Graph Store
// Reads and writes the .memory/ folder structure.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { GraphData, FileIndex, IndexedFile } from './types';

/** Name of the output directory placed at the project root */
export const MEMORY_DIR = '.memory';

export class GraphStore {
    /** Absolute path to .memory/ given a project root */
    static memoryDir(projectRoot: string): string {
        return path.join(projectRoot, MEMORY_DIR);
    }

    /** Check whether a .memory/ index exists for the given root */
    static exists(projectRoot: string): boolean {
        return fs.existsSync(path.join(GraphStore.memoryDir(projectRoot), 'graph.json'));
    }

    /**
     * Write graph.json + index.json + meta.json into .memory/
     * Creates the directory if it does not exist.
     */
    static writeGraph(
        projectRoot: string,
        graph: GraphData,
        fileIndex: FileIndex
    ): void {
        const dir = GraphStore.memoryDir(projectRoot);
        fs.mkdirSync(dir, { recursive: true });

        // Write graph.json
        fs.writeFileSync(
            path.join(dir, 'graph.json'),
            JSON.stringify(graph, null, 2),
            'utf-8'
        );

        // Write index.json
        fs.writeFileSync(
            path.join(dir, 'index.json'),
            JSON.stringify(fileIndex, null, 2),
            'utf-8'
        );

        // Write meta.json (lightweight summary, no node/edge data)
        const meta = {
            version: graph.version,
            generated_at: graph.generated_at,
            project_root: graph.project_root,
            stats: graph.stats,
        };
        fs.writeFileSync(
            path.join(dir, 'meta.json'),
            JSON.stringify(meta, null, 2),
            'utf-8'
        );
    }

    /** Read graph.json from .memory/ */
    static readGraph(projectRoot: string): GraphData | null {
        const graphPath = path.join(GraphStore.memoryDir(projectRoot), 'graph.json');
        if (!fs.existsSync(graphPath)) { return null; }
        try {
            return JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphData;
        } catch {
            return null;
        }
    }

    /** Read meta.json (fast, no full graph) */
    static readMeta(projectRoot: string): Partial<GraphData> | null {
        const metaPath = path.join(GraphStore.memoryDir(projectRoot), 'meta.json');
        if (!fs.existsSync(metaPath)) { return null; }
        try {
            return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        } catch {
            return null;
        }
    }

    /** Delete the entire .memory/ directory */
    static clear(projectRoot: string): void {
        const dir = GraphStore.memoryDir(projectRoot);
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    /** Build a FileIndex entry for a scanned file */
    static makeIndexEntry(
        relativePath: string,
        language: string,
        hash: string,
        lastModified: string,
        nodeCount: number
    ): IndexedFile {
        return {
            path: relativePath,
            language,
            hash,
            last_modified: lastModified,
            indexed_at: new Date().toISOString(),
            node_count: nodeCount,
        };
    }
}
