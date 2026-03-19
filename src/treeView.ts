import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraIssueListItem } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig, getPlatform } from './config';
import { ConnectionManager } from './connectionManager';
import { MemoryManager } from './memory';
import { localize } from './i18n';

/**
 * TreeView ?ъ씠?쒕컮 紐⑤뱢.
 *
 * VS Code Activity Bar??"Jira Agent" ?⑤꼸???깅줉?섍퀬,
 * 濡쒓렇???곹깭, ???댁뒋(?곹깭蹂?洹몃９), ???꾪꽣, JQL 寃??寃곌낵,
 * 異붿쟻 ?몄뀡 ?꾪솴???몃━ 援ъ“濡??쒖떆?쒕떎.
 */

// ??? TreeItem ????뺤쓽 ???

/** ?몃━ ?몃뱶???좏삎??援щ텇?섎뒗 contextValue */
type TreeNodeType =
    | 'status'          // 濡쒓렇???곹깭 ?몃뱶
    | 'platform'        // ?뚮옯???좏깮 ?몃뱶
    | 'category'        // 移댄뀒怨좊━ ?ㅻ뜑 (???댁뒋, ???꾪꽣 ??
    | 'statusGroup'     // ?곹깭蹂?洹몃９ (To Do, In Progress, Done)
    | 'jiraIssue'       // ?댁뒋 ??ぉ
    | 'jiraFilter'      // ?꾪꽣 ??ぉ
    | 'action'          // 寃?? ?덈줈怨좎묠 ???≪뀡
    | 'trackingSession' // 異붿쟻 ?몄뀡
    | 'info'            // ?뺣낫 ?쒖떆 (?쎄린 ?꾩슜)
    ;

export class JiraTreeItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly nodeType: TreeNodeType,
        public readonly meta?: Record<string, any>,
    ) {
        super(label, collapsibleState);
        this.contextValue = nodeType;
    }
}

// ??? TreeDataProvider ???

export class JiraTreeDataProvider implements vscode.TreeDataProvider<JiraTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<JiraTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** JQL 寃??寃곌낵瑜??꾩떆 蹂닿? */
    private _searchResults: JiraIssueListItem[] = [];
    private _searchLabel = '';

    constructor(
        private readonly connectionManager: ConnectionManager,
        private readonly memoryManager: MemoryManager,
    ) {
        // ?곌껐 ?곹깭 蹂寃????몃━ 媛깆떊
        connectionManager.onDidChangeConnection(() => this.refresh());
    }

    /** ?몃??먯꽌 ?몃━ 媛깆떊???몃━嫄?*/
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** JQL 寃??寃곌낵瑜??명똿?섍퀬 ?몃━ 媛깆떊 */
    setSearchResults(label: string, issues: JiraIssueListItem[]): void {
        this._searchLabel = label;
        this._searchResults = issues;
        this.refresh();
    }

    /** 寃??寃곌낵 珥덇린??*/
    clearSearchResults(): void {
        this._searchResults = [];
        this._searchLabel = '';
        this.refresh();
    }

    // ??? TreeDataProvider 援ы쁽 ???

    getTreeItem(element: JiraTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: JiraTreeItem): Promise<JiraTreeItem[]> {
        // 猷⑦듃 ?덈꺼: 理쒖긽??移댄뀒怨좊━??
        if (!element) {
            return this.getRootNodes();
        }

        // 移댄뀒怨좊━蹂??섏쐞 ?몃뱶
        switch (element.meta?.['childType']) {
            case 'myIssues':
                return this.getMyIssueGroups();
            case 'myFilters':
                return this.getMyFilters();
            case 'searchResults':
                return this.getSearchResultNodes();
            case 'trackingSessions':
                return this.getTrackingSessionNodes();
            case 'statusDetail': {
                const user = this.connectionManager.currentUser;
                if (!user) { return []; }
                const emailNode = new JiraTreeItem(
                    `$(mail) ${user.emailAddress}`,
                    vscode.TreeItemCollapsibleState.None,
                    'info',
                );
                try {
                    const domain = getTrackerConfig().domain;
                    const domainNode = new JiraTreeItem(
                        `$(globe) ${domain}`,
                        vscode.TreeItemCollapsibleState.None,
                        'info',
                    );
                    domainNode.command = {
                        command: 'vscode.open',
                        title: 'Jira ?닿린',
                        arguments: [vscode.Uri.parse(`https://${domain}`)],
                    };
                    return [emailNode, domainNode];
                } catch {
                    return [emailNode];
                }
            }
            default:
                break;
        }

        // ?곹깭 洹몃９ ?섏쐞: ?댁뒋 紐⑸줉
        if (element.nodeType === 'statusGroup' && element.meta?.['issues']) {
            return this.issueListToNodes(element.meta['issues'] as JiraIssueListItem[]);
        }

        return [];
    }

    // ??? 猷⑦듃 ?몃뱶 ???

    private getRootNodes(): JiraTreeItem[] {
        const nodes: JiraTreeItem[] = [];

        // 1) ?뚮옯???좏깮 (??긽 ?쒖떆)
        const platformNode = this.buildPlatformNode();
        nodes.push(platformNode);

        // 2) 濡쒓렇???곹깭
        const statusNode = this.buildStatusNode();
        nodes.push(statusNode);

        if (this.connectionManager.isConnected) {
            // 3) ???댁뒋
            const myIssues = new JiraTreeItem(
                localize('tree.myIssues'),
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                { childType: 'myIssues' },
            );
            nodes.push(myIssues);

            // 4) ???꾪꽣
            const myFilters = new JiraTreeItem(
                localize('tree.myFilters'),
                vscode.TreeItemCollapsibleState.Collapsed,
                'category',
                { childType: 'myFilters' },
            );
            nodes.push(myFilters);

            // 5) JQL 寃??
            const searchNode = new JiraTreeItem(
                localize('tree.jqlSearch'),
                this._searchResults.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None,
                'action',
                { childType: 'searchResults' },
            );
            searchNode.command = {
                command: 'orx.searchJql',
                title: localize('tree.jqlSearch'),
            };
            if (this._searchResults.length > 0) {
                searchNode.description = `${this._searchLabel} (${this._searchResults.length}嫄?`;
            }
            nodes.push(searchNode);
        }

        // 6) 異붿쟻 ?몄뀡 (?곌껐 ?щ?? 臾닿??섍쾶 ?쒖떆)
        const sessions = this.memoryManager.getActiveSessions?.() ?? [];
        const currentSession = this.memoryManager.getSession();
        if (currentSession || sessions.length > 0) {
            const trackingNode = new JiraTreeItem(
                localize('tree.trackingSession'),
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                { childType: 'trackingSessions' },
            );
            nodes.push(trackingNode);
        }

        return nodes;
    }

    // ??? 濡쒓렇???곹깭 ?몃뱶 ???

    /**
     * ?꾩옱 ?좏깮???뚮옯?쇱쓣 蹂댁뿬二쇰뒗 ?몃뱶.
     * ?대┃ ??Quick Pick?쇰줈 ?뚮옯?쇱쓣 蹂寃쏀븷 ???덈떎.
     */
    private buildPlatformNode(): JiraTreeItem {
        const platformLabels: Record<string, string> = {
            'jira-cloud': 'Jira Cloud',
            'jira-server': 'Jira Server / DC',
            'github': 'GitHub',
            'linear': 'Linear',
        };
        const currentPlatform = getPlatform();
        const label = platformLabels[currentPlatform] ?? currentPlatform;

        const node = new JiraTreeItem(
            `${localize('tree.platform.label')}: ${label}`,
            vscode.TreeItemCollapsibleState.None,
            'platform',
        );
        node.iconPath = new vscode.ThemeIcon('plug');
        node.tooltip = '?대┃?섏뿬 ?뚮옯?쇱쓣 蹂寃쏀빀?덈떎';
        node.command = {
            command: 'orx.selectPlatform',
            title: 'Select Platform',
        };
        return node;
    }

    private buildStatusNode(): JiraTreeItem {
        const cm = this.connectionManager;

        if (cm.status === 'checking') {
            const node = new JiraTreeItem(
                '??checking...',
                vscode.TreeItemCollapsibleState.None,
                'status',
            );
            node.iconPath = new vscode.ThemeIcon('sync~spin');
            return node;
        }

        if (cm.isConnected && cm.currentUser) {
            const user = cm.currentUser;
            const node = new JiraTreeItem(
                `?뫀 ${user.displayName}`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'status',
                { childType: 'statusDetail' },
            );
            node.description = localize('tree.status.loggedIn');
            node.tooltip = `${localize('tree.status.loggedIn')}\n${user.displayName} (${user.emailAddress})`;
            node.iconPath = new vscode.ThemeIcon('verified');
            return node;
        }

        // 誘몄뿰寃???濡쒓렇???좊룄
        const node = new JiraTreeItem(
            localize('tree.login.action'),
            vscode.TreeItemCollapsibleState.None,
            'status',
        );
        node.description = localize('tree.status.loggedOut');
        node.tooltip = '?대┃?섏뿬 濡쒓렇?명빀?덈떎';
        node.iconPath = new vscode.ThemeIcon('sign-in');
        node.command = {
            command: 'orx.login',
            title: 'Sign In',
        };
        return node;
    }

    // ??? ???댁뒋 (?곹깭蹂?洹몃９) ???

    private async getMyIssueGroups(): Promise<JiraTreeItem[]> {
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const issues = await adapter.searchByJql(
                'assignee = currentUser() AND statusCategory != "Done" ORDER BY updated DESC',
                50,
            );

            // 理쒓렐 ?꾨즺???댁뒋???쒖떆 (7???대궡)
            const doneIssues = await adapter.searchByJql(
                'assignee = currentUser() AND statusCategory = "Done" AND updated >= -7d ORDER BY updated DESC',
                10,
            );

            // statusCategory蹂?洹몃９??
            const groups = new Map<string, JiraIssueListItem[]>();
            for (const issue of issues) {
                const cat = issue.statusCategory || 'Unknown';
                if (!groups.has(cat)) { groups.set(cat, []); }
                groups.get(cat)!.push(issue);
            }
            if (doneIssues.length > 0) {
                groups.set('Done (理쒓렐 7??', doneIssues);
            }

            // ?곹깭 移댄뀒怨좊━ ?꾩씠肄?留ㅽ븨
            const iconMap: Record<string, string> = {
                'To Do': '燧?,
                'In Progress': '?윞',
                'Done (理쒓렐 7??': '??,
            };

            const nodes: JiraTreeItem[] = [];
            for (const [category, categoryIssues] of groups) {
                const icon = iconMap[category] ?? '?뱦';
                const node = new JiraTreeItem(
                    `${icon} ${category} (${categoryIssues.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'statusGroup',
                    { issues: categoryIssues },
                );
                nodes.push(node);
            }
            return nodes;
        } catch (err: any) {
            const errNode = new JiraTreeItem(
                `?좑툘 ?댁뒋 議고쉶 ?ㅽ뙣: ${err.message}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
            );
            return [errNode];
        }
    }

    // ??? ???꾪꽣 ???

    private async getMyFilters(): Promise<JiraTreeItem[]> {
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const filters = await adapter.getFavouriteFilters();

            if (filters.length === 0) {
                return [new JiraTreeItem(
                    '利먭꺼李얘린 ?꾪꽣媛 ?놁뒿?덈떎',
                    vscode.TreeItemCollapsibleState.None,
                    'status',
                )];
            }

            return filters.map((f) => {
                const node = new JiraTreeItem(
                    f.name,
                    vscode.TreeItemCollapsibleState.None,
                    'jiraFilter',
                    { filter: f },
                );
                node.description = f.jql.length > 50 ? f.jql.substring(0, 47) + '...' : f.jql;
                node.tooltip = `JQL: ${f.jql}`;
                node.iconPath = new vscode.ThemeIcon('filter');
                node.command = {
                    command: 'orx.runFilter',
                    title: '?꾪꽣 ?ㅽ뻾',
                    arguments: [f],
                };
                return node;
            });
        } catch (err: any) {
            return [new JiraTreeItem(
                `?좑툘 ?꾪꽣 議고쉶 ?ㅽ뙣: ${err.message}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
            )];
        }
    }

    // ??? 寃??寃곌낵 ???

    private getSearchResultNodes(): JiraTreeItem[] {
        if (this._searchResults.length === 0) {
            return [new JiraTreeItem(
                '寃??寃곌낵媛 ?놁뒿?덈떎',
                vscode.TreeItemCollapsibleState.None,
                'status',
            )];
        }
        return this.issueListToNodes(this._searchResults);
    }

    // ??? 異붿쟻 ?몄뀡 ???

    private getTrackingSessionNodes(): JiraTreeItem[] {
        const session = this.memoryManager.getSession();
        if (!session) {
            return [];
        }

        const stats = this.memoryManager.getStats();
        const node = new JiraTreeItem(
            `${session.issueKey}`,
            vscode.TreeItemCollapsibleState.None,
            'trackingSession',
            { session },
        );
        node.description = `$(file) ${stats?.files ?? 0} $(terminal) ${stats?.terminal ?? 0}`;
        node.iconPath = new vscode.ThemeIcon('record');
        return [node];
    }

    // ??? ?댁뒋 ??TreeItem 蹂?????

    private issueListToNodes(issues: JiraIssueListItem[]): JiraTreeItem[] {
        return issues.map((issue) => {
            const priorityIcon = this.getPriorityIcon(issue.priority);
            const node = new JiraTreeItem(
                `${priorityIcon} ${issue.key}`,
                vscode.TreeItemCollapsibleState.None,
                'jiraIssue',
                { issueKey: issue.key },
            );
            node.description = issue.summary;
            node.tooltip = `${issue.key}: ${issue.summary}\n?곹깭: ${issue.status}\n?곗꽑?쒖쐞: ${issue.priority}\n?대떦?? ${issue.assignee ?? '誘몃같??}`;
            node.iconPath = new vscode.ThemeIcon('issues');
            node.command = {
                command: 'orx.fetchIssue',
                title: '?댁뒋 議고쉶',
                arguments: [issue.key],
            };
            return node;
        });
    }

    private getPriorityIcon(priority: string): string {
        switch (priority.toLowerCase()) {
            case 'highest': case 'blocker': return '?뵶';
            case 'high': case 'critical': return '?윝';
            case 'medium': return '?윞';
            case 'low': return '?윟';
            case 'lowest': return '??;
            default: return '??;
        }
    }
}
