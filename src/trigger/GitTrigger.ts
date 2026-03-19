/**
 * Orx — Git 커밋 자동 트리거.
 *
 * VS Code Git Extension API의 Repository.state.onDidChange를 활용하여
 * 새 커밋이 발생할 때 세션에 자동으로 추가합니다.
 *
 * ⚠️ onDidSaveTextDocument는 파일 저장 이벤트이지 커밋이 아닙니다.
 *    반드시 vscode.git API의 HEAD 변경을 감시해야 합니다.
 */
import * as vscode from 'vscode';
import { MemoryManager } from '../memory';

export class GitTrigger implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private lastKnownHead: string | null = null;

    constructor(private readonly memory: MemoryManager) {}

    /**
     * Git HEAD 변경 감시를 시작합니다.
     * 새 커밋이 감지되면 현재 활성 세션에 자동으로 추가됩니다.
     */
    async register(): Promise<void> {
        try {
            const gitExt = vscode.extensions.getExtension<any>('vscode.git');
            if (!gitExt) {
                console.warn('[Orx GitTrigger] vscode.git 확장이 없습니다.');
                return;
            }

            const git = gitExt.isActive ? gitExt.exports : await gitExt.activate();
            const api = git.getAPI(1);

            if (!api || api.repositories.length === 0) {
                console.warn('[Orx GitTrigger] Git 저장소를 찾을 수 없습니다.');
                return;
            }

            const repo = api.repositories[0];
            this.lastKnownHead = repo.state.HEAD?.commit ?? null;

            // Repository 상태 변화 감시 (HEAD 변경 = 커밋, checkout, merge 등)
            const stateWatcher = repo.state.onDidChange(() => {
                this.onRepoStateChange(repo);
            });
            this.disposables.push(stateWatcher);

            console.log('[Orx GitTrigger] Git HEAD 감시 시작');
        } catch (err: any) {
            console.error('[Orx GitTrigger] 초기화 실패:', err.message);
        }
    }

    /**
     * Repository 상태 변경 핸들러.
     * HEAD가 변경되었고 새 커밋 해시가 이전과 다르면 세션에 추가.
     */
    private async onRepoStateChange(repo: any): Promise<void> {
        const newHead = repo.state.HEAD?.commit;
        if (!newHead || newHead === this.lastKnownHead) {
            return;
        }

        this.lastKnownHead = newHead;

        // 활성 세션이 있을 때만 커밋 추가
        const session = this.memory.getSession();
        if (session) {
            await this.memory.addCommit(newHead);
            console.log(`[Orx GitTrigger] 커밋 자동 수집: ${newHead.substring(0, 8)}`);
        }
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}
