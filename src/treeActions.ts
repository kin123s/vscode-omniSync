import * as vscode from 'vscode';
import { JiraTreeDataProvider } from './treeView';
import { JiraTrackerAdapter, JiraFilter } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig } from './config';
import { ConnectionManager } from './connectionManager';

/**
 * TreeView 액션 모듈.
 *
 * 사이드바의 TreeView 항목을 클릭하거나 우클릭할 때
 * 실행되는 커맨드 핸들러를 모아둔다.
 */

/**
 * TreeView 관련 커맨드를 등록하고, Disposable 배열을 반환한다.
 */
export function registerTreeActions(
    treeProvider: JiraTreeDataProvider,
    _connectionManager: ConnectionManager,
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // 참고: refreshTree, searchIssues는 activate()에서 이미 등록됨

    // ── 브라우저에서 열기 ──
    disposables.push(
        vscode.commands.registerCommand(
            'universal-agent.openInBrowser',
            (item?: { meta?: Record<string, any> }) => {
                const issueKey = item?.meta?.['issueKey'];
                if (!issueKey) { return; }

                try {
                    const config = getTrackerConfig();
                    const url = `https://${config.domain}/browse/${issueKey}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                } catch {
                    vscode.window.showErrorMessage('Jira 설정을 먼저 입력해 주세요.');
                }
            },
        ),
    );

    // ── JQL 검색 ──
    disposables.push(
        vscode.commands.registerCommand('universal-agent.searchJql', async () => {
            const jql = await vscode.window.showInputBox({
                prompt: 'JQL 쿼리를 입력하세요',
                placeHolder: 'project = PROJ AND status = "In Progress"',
                ignoreFocusOut: true,
            });

            if (!jql) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'JQL 검색 중...' },
                async () => {
                    try {
                        const config = getTrackerConfig();
                        const adapter = new JiraTrackerAdapter(config);
                        const issues = await adapter.searchByJql(jql, 50);

                        treeProvider.setSearchResults(
                            `${jql.substring(0, 40)}${jql.length > 40 ? '...' : ''} — ${issues.length}건`,
                            issues,
                        );

                        vscode.window.showInformationMessage(`🔍 검색 완료: ${issues.length}건`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`JQL 검색 실패: ${err.message}`);
                    }
                },
            );
        }),
    );

    // ── 필터 실행 ──
    disposables.push(
        vscode.commands.registerCommand(
            'universal-agent.runFilter',
            async (filter?: JiraFilter) => {
                if (!filter?.jql) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `필터 실행: ${filter.name}` },
                    async () => {
                        try {
                            const config = getTrackerConfig();
                            const adapter = new JiraTrackerAdapter(config);
                            const issues = await adapter.searchByJql(filter.jql, 50);

                            treeProvider.setSearchResults(
                                `${filter.name} — ${issues.length}건`,
                                issues,
                            );
                        } catch (err: any) {
                            vscode.window.showErrorMessage(`필터 실행 실패: ${err.message}`);
                        }
                    },
                );
            },
        ),
    );

    return disposables;
}
