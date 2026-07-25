// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Parser Interface
// ─────────────────────────────────────────────────────────────────────────────

import { ParseResult } from '../graph/types';

export interface IParser {
    /**
     * Parse source code and extract graph nodes & edges.
     * @param filePath   Relative path from project root (used for node IDs)
     * @param source     Raw source code content
     * @param language   Language identifier (e.g. "java", "python")
     */
    parse(filePath: string, source: string, language: string): Promise<ParseResult>;
}
