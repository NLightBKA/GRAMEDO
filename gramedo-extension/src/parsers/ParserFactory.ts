// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Parser Factory
// Returns the correct parser instance for a given language.
// ─────────────────────────────────────────────────────────────────────────────

import * as path from 'path';
import { IParser } from './IParser';
import { JavaParser } from './JavaParser';
import { PythonParser } from './PythonParser';
import { CSharpParser } from './CSharpParser';
import { CppParser } from './CppParser';
import { JavaScriptParser } from './JavaScriptParser';
import { SupportedLanguage } from '../core/LanguageDetector';

export class ParserFactory {
    /** Cache parser instances (each is initialized once with its WASM grammar) */
    private static cache = new Map<string, IParser>();

    /**
     * @param language    Language identifier (e.g. "java", "python")
     * @param wasmDir     Absolute path to the directory containing *.wasm files
     */
    static getParser(language: SupportedLanguage, wasmDir: string): IParser {
        if (ParserFactory.cache.has(language)) {
            return ParserFactory.cache.get(language)!;
        }

        let parser: IParser;

        switch (language) {
            case 'java':
                parser = new JavaParser(wasmDir);
                break;
            case 'python':
                parser = new PythonParser(wasmDir);
                break;
            case 'csharp':
                parser = new CSharpParser(wasmDir);
                break;
            case 'cpp':
                parser = new CppParser(wasmDir);
                break;
            case 'javascript':
            case 'typescript':
                // Shared instance — the TS compiler API supports both
                if (!ParserFactory.cache.has('__jsTs')) {
                    const p = new JavaScriptParser();
                    ParserFactory.cache.set('__jsTs', p);
                }
                return ParserFactory.cache.get('__jsTs')!;
            default:
                throw new Error(`[ParserFactory] Unsupported language: ${language}`);
        }

        ParserFactory.cache.set(language, parser);
        return parser;
    }

    /** Clear cached instances (call if extension is deactivated) */
    static clearCache(): void {
        ParserFactory.cache.clear();
    }
}
