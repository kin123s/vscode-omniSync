import * as vscode from 'vscode';
import { MemoryManager, FileChangeEntry, TerminalEntry } from './memory';

/**
 * Tracker module.
 *
 * Tool-agnostic work tracking engine that collects development activities.
 * Layer 1 (File change tracking) + Layer 2 (Terminal command tracking)
 * are recorded via MemoryManager.
 */
export class Tracker {
    private disposables: vscode.Disposable[] = [];
    private isActive = false;
    private statusBarItem: vscode.StatusBarItem;
    private gitBaseRef: string | null = null;

    constructor(private readonly memory: MemoryManager) {
        // Status bar item for tracking state (always created, initially hidden)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'orx.toggleTracking';
        this.updateStatusBar();
    }

    /** Whether tracking is currently active */
    get tracking(): boolean {
        return this.isActive;
    }

    /**
     * Starts tracking.
     * Registers file-change watchers and terminal-execution listeners.
     */
    async start(issueKey: string): Promise<void> {
        if (this.isActive) {
            return;
        }

        // Capture current Git HEAD as base reference (for computing diffs later)
        this.gitBaseRef = await this.getGitHead();

        await this.memory.startSession(issueKey, this.gitBaseRef ?? undefined);

        // ── L1: File change tracking ──
        const saveWatcher = vscode.workspace.onDidSaveTextDocument(
            async (doc) => {
                await this.onFileSaved(doc);
            }
        );
        this.disposables.push(saveWatcher);

        // File creation/deletion tracking
        const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        fileWatcher.onDidCreate(async (uri) => {
            await this.memory.addFileChange({
                filePath: vscode.workspace.asRelativePath(uri),
                changeType: 'created',
                timestamp: new Date().toISOString(),
            });
        });
        fileWatcher.onDidDelete(async (uri) => {
            await this.memory.addFileChange({
                filePath: vscode.workspace.asRelativePath(uri),
                changeType: 'deleted',
                timestamp: new Date().toISOString(),
            });
        });
        this.disposables.push(fileWatcher);

        // ── L2: Terminal command tracking ──
        const terminalWatcher = vscode.window.onDidStartTerminalShellExecution(
            async (e) => {
                await this.onTerminalExecution(e);
            }
        );
        this.disposables.push(terminalWatcher);

        this.isActive = true;
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    /**
     * Stops tracking. Disposes all watchers and resets state.
     */
    stop(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.isActive = false;
        this.updateStatusBar();
    }

    /** Dispose all resources */
    dispose(): void {
        this.stop();
        this.statusBarItem.dispose();
    }

    // ────── L1: File Change Handler ──────

    private async onFileSaved(doc: vscode.TextDocument): Promise<void> {
        // Ignore node_modules, dist, etc.
        const relativePath = vscode.workspace.asRelativePath(doc.uri);
        if (this.shouldIgnorePath(relativePath)) {
            return;
        }

        // Compute Git diff if available (for richer context)
        let diff: string | undefined;
        if (this.gitBaseRef) {
            diff = await this.getFileDiff(relativePath);
        }

        const entry: FileChangeEntry = {
            filePath: relativePath,
            changeType: 'modified',
            timestamp: new Date().toISOString(),
            diff,
        };

        await this.memory.addFileChange(entry);
    }

    // ────── L2: Terminal Execution Handler ──────

    private async onTerminalExecution(
        e: vscode.TerminalShellExecutionStartEvent
    ): Promise<void> {
        const execution = e.execution;

        // Track command line
        const commandLine = execution.commandLine?.value ?? '';
        if (!commandLine) {
            return;
        }

        // Record the command with its working directory
        const cwd = execution.cwd
            ? vscode.workspace.asRelativePath(execution.cwd)
            : '';

        const entry: TerminalEntry = {
            command: commandLine,
            cwd,
            timestamp: new Date().toISOString(),
        };

        // Wait for command completion to capture exit code
        const endWatcher = vscode.window.onDidEndTerminalShellExecution(
            async (endEvent) => {
                if (endEvent.execution === execution) {
                    entry.exitCode = endEvent.exitCode;
                    await this.memory.addTerminalEntry(entry);
                    endWatcher.dispose();
                }
            }
        );

        // Timeout fallback: if command doesn't complete within 30s, record without exit code
        setTimeout(async () => {
            endWatcher.dispose();
            if (entry.exitCode === undefined) {
                await this.memory.addTerminalEntry(entry);
            }
        }, 30000);
    }

    // ────── Git Utilities ──────

    /**
     * Returns the current Git HEAD commit hash.
     * Returns null if Git extension is unavailable.
     */
    private async getGitHead(): Promise<string | null> {
        try {
            const gitExt = vscode.extensions.getExtension('vscode.git');
            if (!gitExt) {
                return null;
            }

            const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
            const api = git.getAPI(1);
            const repo = api.repositories[0];

            if (!repo) {
                return null;
            }

            return repo.state.HEAD?.commit ?? null;
        } catch {
            return null;
        }
    }

    /**
     * Returns the Git diff for a specific file against the base reference.
     */
    private async getFileDiff(relativePath: string): Promise<string | undefined> {
        try {
            const gitExt = vscode.extensions.getExtension('vscode.git');
            if (!gitExt) {
                return undefined;
            }

            const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
            const api = git.getAPI(1);
            const repo = api.repositories[0];

            if (!repo || !this.gitBaseRef) {
                return undefined;
            }

            const diff = await repo.diffBetween(this.gitBaseRef, 'HEAD', relativePath);
            return diff || undefined;
        } catch {
            return undefined;
        }
    }

    // ────── Utilities ──────

    /** Checks whether a file path should be ignored for tracking */
    private shouldIgnorePath(path: string): boolean {
        const ignorePatterns = [
            'node_modules',
            'dist',
            '.git',
            'package-lock.json',
            '.vscode',
        ];
        return ignorePatterns.some(p => path.includes(p));
    }

    /** Updates status bar UI based on current tracking state */
    private updateStatusBar(): void {
        const session = this.memory.getSession();
        if (this.isActive && session) {
            const stats = this.memory.getStats();
            const fileCount = stats?.files ?? 0;
            const termCount = stats?.terminal ?? 0;
            this.statusBarItem.text = `$(record) ${session.issueKey} | $(file) ${fileCount} $(terminal) ${termCount}`;
            this.statusBarItem.tooltip =
                `Files: ${fileCount} | Terminal: ${termCount} | Chat: ${stats?.chats ?? 0}\nClick to toggle tracking`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        } else {
            this.statusBarItem.text = '$(circle-slash) Tracking: Off';
            this.statusBarItem.tooltip = 'Click to start tracking';
            this.statusBarItem.backgroundColor = undefined;
        }
    }
}
