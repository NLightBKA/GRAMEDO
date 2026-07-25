// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Extension Entry Point
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import * as path from 'path';
import { GramedoPanel } from './panel/GramedoPanel';
import { ParserFactory } from './parsers/ParserFactory';

export function activate(context: vscode.ExtensionContext): void {
    const wasmDir = path.join(context.extensionPath, 'resources', 'wasm');

    // ── Register WebviewView provider ─────────────────────────────────────
    const provider = new GramedoPanel(context.extensionUri, wasmDir);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            GramedoPanel.VIEW_ID,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // ── Register commands ─────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('gramedo.openPanel', () => {
            vscode.commands.executeCommand('workbench.view.extension.gramedo-container');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gramedo.update', async () => {
            await provider.triggerUpdate();
        })
    );

    console.log('[GRAMEDO] Extension activated. WASM dir:', wasmDir);
}

export function deactivate(): void {
    ParserFactory.clearCache();
    console.log('[GRAMEDO] Extension deactivated.');
}
