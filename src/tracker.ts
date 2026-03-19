import * as vscode from 'vscode';
import { MemoryManager, FileChangeEntry, TerminalEntry } from './memory';

/**
 * Tracker 筌뤴뫀諭?
 *
 * AI ?袁㏓럡 ??쑴?썼??곸읅(tool-agnostic) ?臾믩씜 ?곕뗄?삥묾?
 * Layer 1 (???뵬 癰궰野? + Layer 2 (?怨???筌뤿굝議??????쇰뻻揶?揶쏅Ŋ???뤿연
 * MemoryManager??疫꿸퀡以??뺣뼄.
 */
export class Tracker {
    private disposables: vscode.Disposable[] = [];
    private isActive = false;
    private statusBarItem: vscode.StatusBarItem;
    private gitBaseRef: string | null = null;

    constructor(private readonly memory: MemoryManager) {
        // ?怨밴묶獄??袁⑹뵠????밴쉐 (?곕뗄???怨밴묶 ??뽯뻻)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'orx.toggleTracking';
        this.updateStatusBar();
    }

    /** ?곕뗄?????뽮쉐???怨밴묶?紐? ??? */
    get tracking(): boolean {
        return this.isActive;
    }

    /**
     * ?곕뗄?????뽰삂??뺣뼄.
     * ???뵬 ??????源?紐? ?怨?????쎈뻬 ??源?紐? 揶쏅Ŋ???뺣뼄.
     */
    async start(issueKey: string): Promise<void> {
        if (this.isActive) {
            return;
        }

        // Git ?꾩옱 HEAD瑜?湲곗??먯쑝濡????(?섑뼢??diff 怨꾩궛??
        this.gitBaseRef = await this.getGitHead();

        await this.memory.startSession(issueKey, this.gitBaseRef ?? undefined);

        // ???? L1: ???뵬 癰궰野??곕뗄??????
        const saveWatcher = vscode.workspace.onDidSaveTextDocument(
            async (doc) => {
                await this.onFileSaved(doc);
            }
        );
        this.disposables.push(saveWatcher);

        // ???뵬 ??밴쉐/????揶쏅Ŋ??
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

        // ???? L2: ?怨???筌뤿굝議???곕뗄??????
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
     * ?곕뗄???餓λ쵐???뺣뼄. ??源???귐딅뮞??? 筌뤴뫀紐???곸젫??뺣뼄.
     */
    stop(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.isActive = false;
        this.updateStatusBar();
    }

    /** ?귐딅꺖????곸젫 */
    dispose(): void {
        this.stop();
        this.statusBarItem.dispose();
    }

    // ?????? L1: ???뵬 癰궰野?筌ｌ꼶????????

    private async onFileSaved(doc: vscode.TextDocument): Promise<void> {
        // node_modules, dist ???얜똻??
        const relativePath = vscode.workspace.asRelativePath(doc.uri);
        if (this.shouldIgnorePath(relativePath)) {
            return;
        }

        // Git diff ?④쑴沅?(揶쎛?館釉?野껋럩??
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

    // ?????? L2: ?怨???筌뤿굝議??筌ｌ꼶????????

    private async onTerminalExecution(
        e: vscode.TerminalShellExecutionStartEvent
    ): Promise<void> {
        const execution = e.execution;

        // 筌뤿굝議????용뮞???곕뗄??
        const commandLine = execution.commandLine?.value ?? '';
        if (!commandLine) {
            return;
        }

        // 筌뤿굝議????쎈뻬 ?袁⑥┷??疫꿸퀡???exitCode????륁춿
        const cwd = execution.cwd
            ? vscode.workspace.asRelativePath(execution.cwd)
            : '';

        const entry: TerminalEntry = {
            command: commandLine,
            cwd,
            timestamp: new Date().toISOString(),
        };

        // ?ル굝利???源?硫? 獄쏆뮇源??롢늺 exitCode ??낅쑓??꾨뱜
        const endWatcher = vscode.window.onDidEndTerminalShellExecution(
            async (endEvent) => {
                if (endEvent.execution === execution) {
                    entry.exitCode = endEvent.exitCode;
                    await this.memory.addTerminalEntry(entry);
                    endWatcher.dispose();
                }
            }
        );

        // ???袁⑸툡?? 30???袁⑸퓠???ル굝利?????롢늺 域밸챶源?疫꿸퀡以?
        setTimeout(async () => {
            endWatcher.dispose();
            if (entry.exitCode === undefined) {
                await this.memory.addTerminalEntry(entry);
            }
        }, 30000);
    }

    // ?????? Git ?醫뤿뼢?귐뗫뼒 ??????

    /**
     * ?袁⑹삺 Git HEAD???뚣끇而???곷뻻??揶쎛?紐꾩궔??
     * Git???λ뜃由?遺얜┷筌왖 ??녿릭??겹늺 null??獄쏆꼹??
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
     * ?諭?????뵬??Git diff??揶쎛?紐꾩궔??(?곕뗄????뽰삂 ??뽰젎 ????.
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

    // ?????? ?醫뤿뼢?귐뗫뼒 ??????

    /** ?얜똻???野껋럥以????쉘 */
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

    /** ?怨밴묶獄?UI ??낅쑓??꾨뱜 */
    private updateStatusBar(): void {
        const session = this.memory.getSession();
        if (this.isActive && session) {
            const stats = this.memory.getStats();
            const fileCount = stats?.files ?? 0;
            const termCount = stats?.terminal ?? 0;
            this.statusBarItem.text = `$(record) ${session.issueKey} | $(file) ${fileCount} $(terminal) ${termCount}`;
            this.statusBarItem.tooltip =
                `???뵬: ${fileCount} | ?怨??? ${termCount} | ???? ${stats?.chats ?? 0}\n?????뤿연 ?곕뗄??餓λ쵐?`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        } else {
            this.statusBarItem.text = '$(circle-slash) Tracking: Off';
            this.statusBarItem.tooltip = '?????뤿연 ?곕뗄????뽰삂';
            this.statusBarItem.backgroundColor = undefined;
        }
    }
}
