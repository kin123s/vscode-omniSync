import * as vscode from 'vscode';
import { JiraTreeDataProvider } from './treeView';
import { JiraTrackerAdapter, JiraFilter } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig } from './config';
import { ConnectionManager } from './connectionManager';

/**
 * TreeView ?≪뀡 紐⑤뱢.
 *
 * ?ъ씠?쒕컮??TreeView ??ぉ???대┃?섍굅???고겢由?븷 ??
 * ?ㅽ뻾?섎뒗 而ㅻ㎤???몃뱾?щ? 紐⑥븘?붾떎.
 */

/**
 * TreeView 愿??而ㅻ㎤?쒕? ?깅줉?섍퀬, Disposable 諛곗뿴??諛섑솚?쒕떎.
 */
export function registerTreeActions(
    treeProvider: JiraTreeDataProvider,
    _connectionManager: ConnectionManager,
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // 李멸퀬: refreshTree, searchIssues??activate()?먯꽌 ?대? ?깅줉??

    // ?? 釉뚮씪?곗??먯꽌 ?닿린 ??
    disposables.push(
        vscode.commands.registerCommand(
            'orx.openInBrowser',
            (item?: { meta?: Record<string, any> }) => {
                const issueKey = item?.meta?.['issueKey'];
                if (!issueKey) { return; }

                try {
                    const config = getTrackerConfig();
                    const url = `https://${config.domain}/browse/${issueKey}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                } catch {
                    vscode.window.showErrorMessage('Jira ?ㅼ젙??癒쇱? ?낅젰??二쇱꽭??');
                }
            },
        ),
    );

    // ?? JQL 寃????
    disposables.push(
        vscode.commands.registerCommand('orx.searchJql', async () => {
            const jql = await vscode.window.showInputBox({
                prompt: 'JQL 荑쇰━瑜??낅젰?섏꽭??,
                placeHolder: 'project = PROJ AND status = "In Progress"',
                ignoreFocusOut: true,
            });

            if (!jql) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'JQL 寃??以?..' },
                async () => {
                    try {
                        const config = getTrackerConfig();
                        const adapter = new JiraTrackerAdapter(config);
                        const issues = await adapter.searchByJql(jql, 50);

                        treeProvider.setSearchResults(
                            `${jql.substring(0, 40)}${jql.length > 40 ? '...' : ''} ??${issues.length}嫄?,
                            issues,
                        );

                        vscode.window.showInformationMessage(`?뵇 寃???꾨즺: ${issues.length}嫄?);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`JQL 寃???ㅽ뙣: ${err.message}`);
                    }
                },
            );
        }),
    );

    // ?? ?꾪꽣 ?ㅽ뻾 ??
    disposables.push(
        vscode.commands.registerCommand(
            'orx.runFilter',
            async (filter?: JiraFilter) => {
                if (!filter?.jql) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `?꾪꽣 ?ㅽ뻾: ${filter.name}` },
                    async () => {
                        try {
                            const config = getTrackerConfig();
                            const adapter = new JiraTrackerAdapter(config);
                            const issues = await adapter.searchByJql(filter.jql, 50);

                            treeProvider.setSearchResults(
                                `${filter.name} ??${issues.length}嫄?,
                                issues,
                            );
                        } catch (err: any) {
                            vscode.window.showErrorMessage(`?꾪꽣 ?ㅽ뻾 ?ㅽ뙣: ${err.message}`);
                        }
                    },
                );
            },
        ),
    );

    return disposables;
}
