import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraUser } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig } from './config';

/**
 * ConnectionManager 모듈.
 *
 * 트래커 연결 상태를 중앙 관리하는 싱글톤.
 * `/myself` API를 호출하여 인증 검증 + 사용자 정보를 캐싱하고,
 * 설정 변경 시 자동으로 재검증한다.
 *
 * TreeView, 상태바 등 여러 UI 컴포넌트가 이 모듈의 상태를 구독한다.
 */

/** 연결 상태 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

export class ConnectionManager implements vscode.Disposable {
    private _status: ConnectionStatus = 'disconnected';
    private _user: JiraUser | null = null;
    private _disposables: vscode.Disposable[] = [];

    // 상태 변경 이벤트 (TreeView 갱신 트리거)
    private _onDidChangeConnection = new vscode.EventEmitter<ConnectionStatus>();
    public readonly onDidChangeConnection = this._onDidChangeConnection.event;

    constructor() {
        // Settings가 변경되면 자동으로 연결 재검증
        const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('universalAgent')) {
                this.checkConnection();
            }
        });
        this._disposables.push(configWatcher);
    }

    /** 현재 연결 상태 */
    get status(): ConnectionStatus {
        return this._status;
    }

    /** 연결 여부 (boolean shorthand) */
    get isConnected(): boolean {
        return this._status === 'connected';
    }

    /** 현재 로그인된 사용자 정보 (미연결 시 null) */
    get currentUser(): JiraUser | null {
        return this._user;
    }

    /**
     * Jira 인증을 검증한다.
     * `/myself` API를 호출하여 성공 시 사용자 정보를 캐싱하고,
     * 실패 시 disconnected 상태로 전환한다.
     */
    async checkConnection(): Promise<boolean> {
        this._status = 'checking';
        this._onDidChangeConnection.fire(this._status);

        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const user = await adapter.getMyself();

            this._user = user;
            this._status = 'connected';
            this._onDidChangeConnection.fire(this._status);
            return true;
        } catch {
            this._user = null;
            this._status = 'disconnected';
            this._onDidChangeConnection.fire(this._status);
            return false;
        }
    }

    dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._onDidChangeConnection.dispose();
    }
}
