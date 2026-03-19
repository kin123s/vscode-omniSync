import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraUser } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig } from './config';

/**
 * ConnectionManager 紐⑤뱢.
 *
 * ?몃옒而??곌껐 ?곹깭瑜?以묒븰 愿由ы븯???깃???
 * `/myself` API瑜??몄텧?섏뿬 ?몄쬆 寃利?+ ?ъ슜???뺣낫瑜?罹먯떛?섍퀬,
 * ?ㅼ젙 蹂寃????먮룞?쇰줈 ?ш?利앺븳??
 *
 * TreeView, ?곹깭諛????щ윭 UI 而댄룷?뚰듃媛 ??紐⑤뱢???곹깭瑜?援щ룆?쒕떎.
 */

/** ?곌껐 ?곹깭 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'checking';

export class ConnectionManager implements vscode.Disposable {
    private _status: ConnectionStatus = 'disconnected';
    private _user: JiraUser | null = null;
    private _disposables: vscode.Disposable[] = [];

    // ?곹깭 蹂寃??대깽??(TreeView 媛깆떊 ?몃━嫄?
    private _onDidChangeConnection = new vscode.EventEmitter<ConnectionStatus>();
    public readonly onDidChangeConnection = this._onDidChangeConnection.event;

    constructor() {
        // Settings媛 蹂寃쎈릺硫??먮룞?쇰줈 ?곌껐 ?ш?利?
        const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('orx')) {
                this.checkConnection();
            }
        });
        this._disposables.push(configWatcher);
    }

    /** ?꾩옱 ?곌껐 ?곹깭 */
    get status(): ConnectionStatus {
        return this._status;
    }

    /** ?곌껐 ?щ? (boolean shorthand) */
    get isConnected(): boolean {
        return this._status === 'connected';
    }

    /** ?꾩옱 濡쒓렇?몃맂 ?ъ슜???뺣낫 (誘몄뿰寃???null) */
    get currentUser(): JiraUser | null {
        return this._user;
    }

    /**
     * Jira ?몄쬆??寃利앺븳??
     * `/myself` API瑜??몄텧?섏뿬 ?깃났 ???ъ슜???뺣낫瑜?罹먯떛?섍퀬,
     * ?ㅽ뙣 ??disconnected ?곹깭濡??꾪솚?쒕떎.
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
