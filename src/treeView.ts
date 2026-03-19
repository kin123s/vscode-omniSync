import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraIssueListItem } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig, getPlatform } from './config';
import { ConnectionManager } from './connectionManager';
import { MemoryManager } from './memory';
import { localize } from './i18n';

/**
 * TreeView Sidebar module.
 *
 * Registered in the VS Code Activity Bar as the "Orx" panel.
 * Displays login status, My Issues (grouped by status), My Filters,
 * JQL search results, and tracking sessions in a tree structure.
 */

// ─── TreeItem Type Definitions ───

/** contextValue used to distinguish tree node types */
type TreeNodeType =
    | 'status'          // Login status node
    | 'platform'        // Platform selection node
    | 'category'        // Category header (My Issues, My Filters, etc.)
    | 'statusGroup'     // Status group (To Do, In Progress, Done)
    | 'jiraIssue'       // Issue item
    | 'jiraFilter'      // Filter item
    | 'action'          // Action node (search, refresh, etc.)
    | 'trackingSession' // Tracking session
    | 'info'            // Info display (read-only)
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

// ─── TreeDataProvider ───

export class JiraTreeDataProvider implements vscode.TreeDataProvider<JiraTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<JiraTreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** Temporarily stores JQL search results */
    private _searchResults: JiraIssueListItem[] = [];
    private _searchLabel = '';

    constructor(
        private readonly connectionManager: ConnectionManager,
        private readonly memoryManager: MemoryManager,
    ) {
        // Refresh tree on connection state change
        connectionManager.onDidChangeConnection(() => this.refresh());
    }

    /** Trigger tree refresh from external callers */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Set JQL search results and refresh tree */
    setSearchResults(label: string, issues: JiraIssueListItem[]): void {
        this._searchLabel = label;
        this._searchResults = issues;
        this.refresh();
    }

    /** Clear search results */
    clearSearchResults(): void {
        this._searchResults = [];
        this._searchLabel = '';
        this.refresh();
    }

    // ─── TreeDataProvider Implementation ───

    getTreeItem(element: JiraTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: JiraTreeItem): Promise<JiraTreeItem[]> {
        // Root level: top-level categories
        if (!element) {
            return this.getRootNodes();
        }

        // Category-specific child nodes
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
                        title: 'Open Jira',
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

        // Status group children: issue list
        if (element.nodeType === 'statusGroup' && element.meta?.['issues']) {
            return this.issueListToNodes(element.meta['issues'] as JiraIssueListItem[]);
        }

        return [];
    }

    // ─── Root Nodes ───

    private getRootNodes(): JiraTreeItem[] {
        const nodes: JiraTreeItem[] = [];

        // 1) Platform selection (always visible)
        const platformNode = this.buildPlatformNode();
        nodes.push(platformNode);

        // 2) Login status
        const statusNode = this.buildStatusNode();
        nodes.push(statusNode);

        if (this.connectionManager.isConnected) {
            // 3) My Issues
            const myIssues = new JiraTreeItem(
                localize('tree.myIssues'),
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                { childType: 'myIssues' },
            );
            nodes.push(myIssues);

            // 4) My Filters
            const myFilters = new JiraTreeItem(
                localize('tree.myFilters'),
                vscode.TreeItemCollapsibleState.Collapsed,
                'category',
                { childType: 'myFilters' },
            );
            nodes.push(myFilters);

            // 5) JQL Search
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
                searchNode.description = `${this._searchLabel} (${this._searchResults.length} results)`;
            }
            nodes.push(searchNode);
        }

        // 6) Tracking sessions (visible regardless of connection)
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

    // ─── Login Status Node ───

    /**
     * Shows the currently selected tracker platform.
     * Clicking opens a Quick Pick to change platform.
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
        node.tooltip = 'Click to change platform';
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
                '⏳ checking...',
                vscode.TreeItemCollapsibleState.None,
                'status',
            );
            node.iconPath = new vscode.ThemeIcon('sync~spin');
            return node;
        }

        if (cm.isConnected && cm.currentUser) {
            const user = cm.currentUser;
            const node = new JiraTreeItem(
                `👤 ${user.displayName}`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'status',
                { childType: 'statusDetail' },
            );
            node.description = localize('tree.status.loggedIn');
            node.tooltip = `${localize('tree.status.loggedIn')}\n${user.displayName} (${user.emailAddress})`;
            node.iconPath = new vscode.ThemeIcon('verified');
            return node;
        }

        // Not connected — prompt login
        const node = new JiraTreeItem(
            localize('tree.login.action'),
            vscode.TreeItemCollapsibleState.None,
            'status',
        );
        node.description = localize('tree.status.loggedOut');
        node.tooltip = 'Click to sign in';
        node.iconPath = new vscode.ThemeIcon('sign-in');
        node.command = {
            command: 'orx.login',
            title: 'Sign In',
        };
        return node;
    }

    // ─── My Issues (Status Groups) ───

    private async getMyIssueGroups(): Promise<JiraTreeItem[]> {
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const issues = await adapter.searchByJql(
                'assignee = currentUser() AND statusCategory != "Done" ORDER BY updated DESC',
                50,
            );

            // Recent done issues (last 7 days)
            const doneIssues = await adapter.searchByJql(
                'assignee = currentUser() AND statusCategory = "Done" AND updated >= -7d ORDER BY updated DESC',
                10,
            );

            // Group by statusCategory
            const groups = new Map<string, JiraIssueListItem[]>();
            for (const issue of issues) {
                const cat = issue.statusCategory || 'Unknown';
                if (!groups.has(cat)) { groups.set(cat, []); }
                groups.get(cat)!.push(issue);
            }
            if (doneIssues.length > 0) {
                groups.set('Done (Last 7 days)', doneIssues);
            }

            // Status category icon mapping
            const iconMap: Record<string, string> = {
                'To Do': '⚪',
                'In Progress': '🔵',
                'Done (Last 7 days)': '✅',
            };

            const nodes: JiraTreeItem[] = [];
            for (const [category, categoryIssues] of groups) {
                const icon = iconMap[category] ?? '📌';
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
                `⚠️ Issue fetch failed: ${err.message}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
            );
            return [errNode];
        }
    }

    // ─── My Filters ───

    private async getMyFilters(): Promise<JiraTreeItem[]> {
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const filters = await adapter.getFavouriteFilters();

            if (filters.length === 0) {
                return [new JiraTreeItem(
                    'No favourite filters found',
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
                    title: 'Run Filter',
                    arguments: [f],
                };
                return node;
            });
        } catch (err: any) {
            return [new JiraTreeItem(
                `⚠️ Filter fetch failed: ${err.message}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
            )];
        }
    }

    // ─── Search Results ───

    private getSearchResultNodes(): JiraTreeItem[] {
        if (this._searchResults.length === 0) {
            return [new JiraTreeItem(
                'No search results',
                vscode.TreeItemCollapsibleState.None,
                'status',
            )];
        }
        return this.issueListToNodes(this._searchResults);
    }

    // ─── Tracking Sessions ───

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

    // ─── Issue → TreeItem Conversion ───

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
            node.tooltip = `${issue.key}: ${issue.summary}\nStatus: ${issue.status}\nPriority: ${issue.priority}\nAssignee: ${issue.assignee ?? 'Unassigned'}`;
            node.iconPath = new vscode.ThemeIcon('issues');
            node.command = {
                command: 'orx.fetchIssue',
                title: 'View Issue',
                arguments: [issue.key],
            };
            return node;
        });
    }

    private getPriorityIcon(priority: string): string {
        switch (priority.toLowerCase()) {
            case 'highest': case 'blocker': return '🔴';
            case 'high': case 'critical': return '🟠';
            case 'medium': return '🟡';
            case 'low': return '🟢';
            case 'lowest': return '⚪';
            default: return '⚪';
        }
    }
}
