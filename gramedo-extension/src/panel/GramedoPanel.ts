// ─────────────────────────────────────────────────────────────────────────────
// GRAMEDO — Webview Panel Controller
// Manages the sidebar WebviewView and all message passing.
// ─────────────────────────────────────────────────────────────────────────────

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { GramedoIndexer } from '../core/GramedoIndexer';
import { GraphStore } from '../graph/GraphStore';

export class GramedoPanel implements vscode.WebviewViewProvider {
    public static readonly VIEW_ID = 'gramedo.panel';

    private _view?: vscode.WebviewView;
    private _indexer: GramedoIndexer;
    private _isBusy = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _wasmDir: string
    ) {
        this._indexer = new GramedoIndexer(_wasmDir);
    }

    // ── WebviewViewProvider ───────────────────────────────────────────────
    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void | Thenable<void> {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtml(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'ready':
                    await this._sendInitState();
                    break;
                case 'update':
                    await this._runUpdate();
                    break;
                case 'browse':
                    await this._browseForRoot();
                    break;
                case 'openMemoryFolder':
                    this._openMemoryFolder();
                    break;
                case 'copyPath':
                    this._copyGraphPath();
                    break;
                case 'clear':
                    await this._clearMemory();
                    break;
            }
        });
    }

    // ── Public API (called from extension.ts commands) ────────────────────
    async triggerUpdate(): Promise<void> {
        await this._runUpdate();
    }

    // ── Private helpers ───────────────────────────────────────────────────

    /** Get the current workspace root (first folder, if any) */
    private _getWorkspaceRoot(): string | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
    }

    /** Get the currently configured project root.
     *  Priority: workspace config → first workspace folder */
    private _getProjectRoot(): string | undefined {
        const config = vscode.workspace.getConfiguration('gramedo');
        const configured = config.get<string>('projectRoot');
        if (configured && fs.existsSync(configured)) {
            return configured;
        }
        return this._getWorkspaceRoot();
    }

    /** Set a new project root in workspace config */
    private async _setProjectRoot(newRoot: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('gramedo');
        await config.update('projectRoot', newRoot, vscode.ConfigurationTarget.Workspace);
    }

    /** Send the initial state to the webview after it loads */
    private async _sendInitState(): Promise<void> {
        const root = this._getProjectRoot();
        const hasMemory = root ? GraphStore.exists(root) : false;
        const meta = root && hasMemory ? GraphStore.readMeta(root) : null;

        this._post({
            type: 'init',
            root: root ?? null,
            hasMemory,
            stats: meta?.stats ?? null,
            lastUpdated: meta?.generated_at ?? null,
            byLanguage: meta?.stats?.by_language ?? {},
        });
    }

    /** Run the indexing pipeline */
    private async _runUpdate(): Promise<void> {
        if (this._isBusy) { return; }

        const root = this._getProjectRoot();
        if (!root) {
            this._post({ type: 'error', message: 'No project root found. Open a workspace folder first.' });
            return;
        }

        this._isBusy = true;

        try {
            await this._indexer.run(root, (event) => {
                if (event.phase === 'done') {
                    this._post({
                        type: 'done',
                        stats: event.stats,
                    });
                } else if (event.phase === 'error') {
                    this._post({ type: 'error', message: event.message });
                } else {
                    this._post({ type: 'progress', ...event });
                }
            });
        } finally {
            this._isBusy = false;
        }
    }

    /** Let user browse for a different project root */
    private async _browseForRoot(): Promise<void> {
        const result = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Set as Project Root',
            title: 'Select Project Root for GRAMEDO Indexing',
        });

        if (!result || result.length === 0) { return; }
        const selected = result[0].fsPath;
        await this._setProjectRoot(selected);

        const hasMemory = GraphStore.exists(selected);
        const meta = hasMemory ? GraphStore.readMeta(selected) : null;

        this._post({
            type: 'rootChanged',
            root: selected,
            hasMemory,
            stats: meta?.stats ?? null,
            lastUpdated: meta?.generated_at ?? null,
            byLanguage: meta?.stats?.by_language ?? {},
        });
    }

    /** Open .memory/ folder in the system file explorer */
    private _openMemoryFolder(): void {
        const root = this._getProjectRoot();
        if (!root) { return; }
        const memDir = vscode.Uri.file(path.join(root, '.memory'));
        vscode.commands.executeCommand('revealFileInOS', memDir);
    }

    /** Copy the absolute path to graph.json */
    private _copyGraphPath(): void {
        const root = this._getProjectRoot();
        if (!root) { return; }
        const graphPath = path.join(root, '.memory', 'graph.json');
        vscode.env.clipboard.writeText(graphPath);
        vscode.window.showInformationMessage(`Copied to clipboard: ${graphPath}`);
    }

    /** Clear the .memory/ directory after confirmation */
    private async _clearMemory(): Promise<void> {
        const root = this._getProjectRoot();
        if (!root) { return; }

        const answer = await vscode.window.showWarningMessage(
            'Delete .memory/ and all indexed data?',
            { modal: true },
            'Delete'
        );
        if (answer !== 'Delete') { return; }

        GraphStore.clear(root);
        this._post({
            type: 'init',
            root,
            hasMemory: false,
            stats: null,
            lastUpdated: null,
            byLanguage: {},
        });
        vscode.window.showInformationMessage('GRAMEDO: .memory/ cleared.');
    }

    /** Post a message to the webview */
    private _post(msg: object): void {
        this._view?.webview.postMessage(msg);
    }

    // ── HTML generation ───────────────────────────────────────────────────

    private _getHtml(webview: vscode.Webview): string {
        const htmlPath = path.join(this._extensionUri.fsPath, 'src', 'webview', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');

        // Replace nonce placeholder
        const nonce = crypto.randomBytes(16).toString('base64');
        html = html.replace(/{{NONCE}}/g, nonce);

        return html;
    }
}
