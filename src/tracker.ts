import * as vscode from 'vscode';
import { MemoryManager, FileChangeEntry, TerminalEntry } from './memory';

/**
 * Tracker 모듈.
 *
 * AI 도구 비의존적(tool-agnostic) 작업 추적기.
 * Layer 1 (파일 변경) + Layer 2 (터미널 명령어)를 실시간 감시하여
 * MemoryManager에 기록한다.
 */
export class Tracker {
    private disposables: vscode.Disposable[] = [];
    private isActive = false;
    private statusBarItem: vscode.StatusBarItem;
    private gitBaseRef: string | null = null;

    constructor(private readonly memory: MemoryManager) {
        // 상태바 아이콘 생성 (추적 상태 표시)
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'universal-agent.toggleTracking';
        this.updateStatusBar();
    }

    /** 추적이 활성화 상태인지 여부 */
    get tracking(): boolean {
        return this.isActive;
    }

    /**
     * 추적을 시작한다.
     * 파일 저장 이벤트와 터미널 실행 이벤트를 감시한다.
     */
    async start(issueKey: string): Promise<void> {
        if (this.isActive) {
            return;
        }

        await this.memory.startSession(issueKey);

        // Git 현재 HEAD를 기준점으로 저장 (나중에 diff 계산용)
        this.gitBaseRef = await this.getGitHead();

        // ── L1: 파일 변경 추적 ──
        const saveWatcher = vscode.workspace.onDidSaveTextDocument(
            async (doc) => {
                await this.onFileSaved(doc);
            }
        );
        this.disposables.push(saveWatcher);

        // 파일 생성/삭제 감시
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

        // ── L2: 터미널 명령어 추적 ──
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
     * 추적을 중지한다. 이벤트 리스너를 모두 해제한다.
     */
    stop(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        this.isActive = false;
        this.updateStatusBar();
    }

    /** 리소스 해제 */
    dispose(): void {
        this.stop();
        this.statusBarItem.dispose();
    }

    // ─── L1: 파일 변경 처리 ───

    private async onFileSaved(doc: vscode.TextDocument): Promise<void> {
        // node_modules, dist 등 무시
        const relativePath = vscode.workspace.asRelativePath(doc.uri);
        if (this.shouldIgnorePath(relativePath)) {
            return;
        }

        // Git diff 계산 (가능한 경우)
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

    // ─── L2: 터미널 명령어 처리 ───

    private async onTerminalExecution(
        e: vscode.TerminalShellExecutionStartEvent
    ): Promise<void> {
        const execution = e.execution;

        // 명령어 텍스트 추출
        const commandLine = execution.commandLine?.value ?? '';
        if (!commandLine) {
            return;
        }

        // 명령어 실행 완료를 기다려 exitCode를 수집
        const cwd = execution.cwd
            ? vscode.workspace.asRelativePath(execution.cwd)
            : '';

        const entry: TerminalEntry = {
            command: commandLine,
            cwd,
            timestamp: new Date().toISOString(),
        };

        // 종료 이벤트가 발생하면 exitCode 업데이트
        const endWatcher = vscode.window.onDidEndTerminalShellExecution(
            async (endEvent) => {
                if (endEvent.execution === execution) {
                    entry.exitCode = endEvent.exitCode;
                    await this.memory.addTerminalEntry(entry);
                    endWatcher.dispose();
                }
            }
        );

        // 타임아웃: 30초 후에도 종료 안 되면 그냥 기록
        setTimeout(async () => {
            endWatcher.dispose();
            if (entry.exitCode === undefined) {
                await this.memory.addTerminalEntry(entry);
            }
        }, 30000);
    }

    // ─── Git 유틸리티 ───

    /**
     * 현재 Git HEAD의 커밋 해시를 가져온다.
     * Git이 초기화되지 않았으면 null을 반환.
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
     * 특정 파일의 Git diff를 가져온다 (추적 시작 시점 대비).
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

    // ─── 유틸리티 ───

    /** 무시할 경로 패턴 */
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

    /** 상태바 UI 업데이트 */
    private updateStatusBar(): void {
        const session = this.memory.getSession();
        if (this.isActive && session) {
            const stats = this.memory.getStats();
            const fileCount = stats?.files ?? 0;
            const termCount = stats?.terminal ?? 0;
            this.statusBarItem.text = `$(record) ${session.issueKey} | $(file) ${fileCount} $(terminal) ${termCount}`;
            this.statusBarItem.tooltip =
                `파일: ${fileCount} | 터미널: ${termCount} | 대화: ${stats?.chats ?? 0}\n클릭하여 추적 중지`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
        } else {
            this.statusBarItem.text = '$(circle-slash) Tracking: Off';
            this.statusBarItem.tooltip = '클릭하여 추적 시작';
            this.statusBarItem.backgroundColor = undefined;
        }
    }
}
