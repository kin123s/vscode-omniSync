import * as vscode from 'vscode';
import { JiraTreeDataProvider } from './treeView';
import { JiraTrackerAdapter, JiraFilter } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig } from './config';
import { ConnectionManager } from './connectionManager';

/**
 * TreeView Actions module.
 *
 * Registers commands that are triggered when the user clicks
 * on sidebar TreeView items or context menus.
 */

/**
 * Registers TreeView-related commands and returns their Disposable array.
 */
export function registerTreeActions(
    treeProvider: JiraTreeDataProvider,
    _connectionManager: ConnectionManager,
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Note: refreshTree, searchIssues are already registered in activate()

    // — Open in Browser —
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
                    vscode.window.showErrorMessage('Please complete Jira settings first.');
                }
            },
        ),
    );

    // — JQL Search —
    disposables.push(
        vscode.commands.registerCommand('orx.searchJql', async () => {
            const jql = await vscode.window.showInputBox({
                prompt: 'Enter a JQL query',
                placeHolder: 'project = PROJ AND status = "In Progress"',
                ignoreFocusOut: true,
            });

            if (!jql) { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Searching JQL...' },
                async () => {
                    try {
                        const config = getTrackerConfig();
                        const adapter = new JiraTrackerAdapter(config);
                        const issues = await adapter.searchByJql(jql, 50);

                        treeProvider.setSearchResults(
                            `${jql.substring(0, 40)}${jql.length > 40 ? '...' : ''} — ${issues.length} results`,
                            issues,
                        );

                        vscode.window.showInformationMessage(`🔍 Search complete: ${issues.length} results`);
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`JQL search failed: ${err.message}`);
                    }
                },
            );
        }),
    );

    // — Run Filter —
    disposables.push(
        vscode.commands.registerCommand(
            'orx.runFilter',
            async (filter?: JiraFilter) => {
                if (!filter?.jql) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: `Running filter: ${filter.name}` },
                    async () => {
                        try {
                            const config = getTrackerConfig();
                            const adapter = new JiraTrackerAdapter(config);
                            const issues = await adapter.searchByJql(filter.jql, 50);

                            treeProvider.setSearchResults(
                                `${filter.name} — ${issues.length} results`,
                                issues,
                            );
                        } catch (err: any) {
                            vscode.window.showErrorMessage(`Filter execution failed: ${err.message}`);
                        }
                    },
                );
            },
        ),
    );

    return disposables;
}
