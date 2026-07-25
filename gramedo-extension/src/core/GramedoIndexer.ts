// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Indexer Orchestrator
// Scan → Parse → Build Graph → Write .memory/
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { ParseResult, ProgressCallback, FileIndex } from '../graph/types';
import { scanProject, readSourceFile, hashContent } from './FileScanner';
import { ParserFactory } from '../parsers/ParserFactory';
import { GraphBuilder } from '../graph/GraphBuilder';
import { GraphStore } from '../graph/GraphStore';
import { SupportedLanguage } from './LanguageDetector';

export class GramedoIndexer {
    constructor(
        /** Absolute path to resources/wasm/ within the extension */
        private readonly wasmDir: string
    ) {}

    /**
     * Full re-index: scan all project files, parse, build graph, write .memory/
     */
    async run(projectRoot: string, onProgress: ProgressCallback): Promise<void> {
        try {
            // ── 1. Scan ───────────────────────────────────────────────────
            const files = await scanProject(projectRoot);
            onProgress({ phase: 'scan', total: files.length });

            if (files.length === 0) {
                onProgress({ phase: 'error', message: 'No supported source files found in the project.' });
                return;
            }

            // ── 2. Parse each file ────────────────────────────────────────
            const parseResults: ParseResult[] = [];
            const indexEntries: FileIndex['files'] = [];

            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                onProgress({ phase: 'parse', current: i + 1, total: files.length, file: file.relativePath });

                const source = readSourceFile(file.absolutePath);
                if (!source) { continue; }

                let result: ParseResult;
                try {
                    const parser = ParserFactory.getParser(file.language as SupportedLanguage, this.wasmDir);
                    result = await parser.parse(file.relativePath, source, file.language);
                } catch (err) {
                    // Parse errors are non-fatal: log and skip this file
                    console.warn(`[GRAMEDO] Parse error in ${file.relativePath}:`, err);
                    continue;
                }

                parseResults.push(result);

                // Get file modification time
                let mtime = new Date().toISOString();
                try {
                    mtime = fs.statSync(file.absolutePath).mtime.toISOString();
                } catch { /* ignore */ }

                indexEntries.push(
                    GraphStore.makeIndexEntry(
                        file.relativePath,
                        file.language,
                        hashContent(source),
                        mtime,
                        result.nodes.length
                    )
                );
            }

            // ── 3. Build unified graph ────────────────────────────────────
            onProgress({ phase: 'build' });
            const graph = GraphBuilder.build(projectRoot, parseResults);

            // ── 4. Write to .memory/ ──────────────────────────────────────
            onProgress({ phase: 'write' });
            const fileIndex: FileIndex = { files: indexEntries };
            GraphStore.writeGraph(projectRoot, graph, fileIndex);

            onProgress({ phase: 'done', stats: graph.stats });

        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            onProgress({ phase: 'error', message });
        }
    }
}
