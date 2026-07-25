// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — File Scanner
// Recursively walks a project root and returns all source files to be parsed.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { ScannedFile } from '../graph/types';
import { detectLanguage, IGNORED_DIRS, SUPPORTED_EXTENSIONS } from './LanguageDetector';

export interface ScanOptions {
    /** Maximum file size in bytes to include (default: 2 MB) */
    maxFileSizeBytes?: number;
    /** Additional directory names to ignore */
    extraIgnoredDirs?: string[];
}

/**
 * Recursively scan a project directory and collect all parseable source files.
 */
export async function scanProject(
    rootPath: string,
    options: ScanOptions = {}
): Promise<ScannedFile[]> {
    const maxSize = options.maxFileSizeBytes ?? 2 * 1024 * 1024; // 2 MB
    const extraIgnore = new Set(options.extraIgnoredDirs ?? []);
    const results: ScannedFile[] = [];

    function walk(dirPath: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch {
            // Permission denied or other error — skip silently
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                // Skip ignored directories
                if (IGNORED_DIRS.has(entry.name) || extraIgnore.has(entry.name)) {
                    continue;
                }
                walk(fullPath);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name);
                if (!SUPPORTED_EXTENSIONS.has(ext.toLowerCase())) {
                    continue;
                }

                let stat: fs.Stats;
                try {
                    stat = fs.statSync(fullPath);
                } catch {
                    continue;
                }

                if (stat.size > maxSize) {
                    continue; // Skip very large files
                }

                const language = detectLanguage(ext);
                if (!language) {
                    continue;
                }

                results.push({
                    absolutePath: fullPath,
                    relativePath: path.relative(rootPath, fullPath).replace(/\\/g, '/'),
                    language,
                    extension: ext,
                    sizeBytes: stat.size,
                });
            }
        }
    }

    walk(rootPath);
    return results;
}

/**
 * Read a source file and return its content as a UTF-8 string.
 * Returns null if the file cannot be read.
 */
export function readSourceFile(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }
}

/**
 * Compute a simple hash of file content for change detection.
 * Uses a djb2-style hash (fast, not cryptographic).
 */
export function hashContent(content: string): string {
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
        hash = hash >>> 0; // keep unsigned 32-bit
    }
    return hash.toString(16).padStart(8, '0');
}
