// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Language Detector
// Maps file extensions to language identifiers.
// ─────────────────────────────────────────────────────────────────────────────

export type SupportedLanguage =
    | 'java'
    | 'javascript'
    | 'typescript'
    | 'python'
    | 'csharp'
    | 'cpp';

const EXT_MAP: Record<string, SupportedLanguage> = {
    '.java'  : 'java',
    '.js'    : 'javascript',
    '.mjs'   : 'javascript',
    '.cjs'   : 'javascript',
    '.jsx'   : 'javascript',
    '.ts'    : 'typescript',
    '.tsx'   : 'typescript',
    '.mts'   : 'typescript',
    '.cts'   : 'typescript',
    '.py'    : 'python',
    '.pyw'   : 'python',
    '.cs'    : 'csharp',
    '.cpp'   : 'cpp',
    '.cc'    : 'cpp',
    '.cxx'   : 'cpp',
    '.c'     : 'cpp',   // treat C as C++ parser (superset)
    '.h'     : 'cpp',
    '.hpp'   : 'cpp',
    '.hxx'   : 'cpp',
};

/**
 * Detect the programming language from a file extension.
 * Returns undefined for unsupported extensions.
 */
export function detectLanguage(ext: string): SupportedLanguage | undefined {
    return EXT_MAP[ext.toLowerCase()];
}

/** All extensions GRAMEDO scans. */
export const SUPPORTED_EXTENSIONS = new Set(Object.keys(EXT_MAP));

/** Directories that should always be skipped during scanning. */
export const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    'dist',
    'build',
    'out',
    'target',      // Java/Maven
    'bin',
    'obj',         // C#/.NET
    '__pycache__',
    '.venv',
    'venv',
    'env',
    '.env',
    '.memory',     // Our own output directory
    '.gramedo',    // Legacy
    'coverage',
    '.nyc_output',
    'vendor',
]);
