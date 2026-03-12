import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraIssueListItem } from './adapters/JiraTrackerAdapter';
import { getTrackerConfig, getPlatform } from './config';
import { ConnectionManager } from './connectionManager';
import { MemoryManager } from './memory';
import { localize } from './i18n';

/**
 * TreeView 사이드바 모듈.
 *
 * VS Code Activity Bar에 "Jira Agent" 패널을 등록하고,
 * 로그인 상태, 내 이슈(상태별 그룹), 내 필터, JQL 검색 결과,
 * 추적 세션 현황을 트리 구조로 표시한다.
 */

// ─── TreeItem 타입 정의 ───

/** 트리 노드의 유형을 구분하는 contextValue */
type TreeNodeType =
    | 'status'          // 로그인 상태 노드
    | 'platform'        // 플랫폼 선택 노드
    | 'category'        // 카테고리 헤더 (내 이슈, 내 필터 등)
    | 'statusGroup'     // 상태별 그룹 (To Do, In Progress, Done)
    | 'jiraIssue'       // 이슈 항목
    | 'jiraFilter'      // 필터 항목
    | 'action'          // 검색, 새로고침 등 액션
    | 'trackingSession' // 추적 세션
    | 'info'            // 정보 표시 (읽기 전용)
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

    /** JQL 검색 결과를 임시 보관 */
    private _searchResults: JiraIssueListItem[] = [];
    private _searchLabel = '';

    constructor(
        private readonly connectionManager: ConnectionManager,
        private readonly memoryManager: MemoryManager,
    ) {
        // 연결 상태 변경 시 트리 갱신
        connectionManager.onDidChangeConnection(() => this.refresh());
    }

    /** 외부에서 트리 갱신을 트리거 */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** JQL 검색 결과를 세팅하고 트리 갱신 */
    setSearchResults(label: string, issues: JiraIssueListItem[]): void {
        this._searchLabel = label;
        this._searchResults = issues;
        this.refresh();
    }

    /** 검색 결과 초기화 */
    clearSearchResults(): void {
        this._searchResults = [];
        this._searchLabel = '';
        this.refresh();
    }

    // ─── TreeDataProvider 구현 ───

    getTreeItem(element: JiraTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: JiraTreeItem): Promise<JiraTreeItem[]> {
        // 루트 레벨: 최상위 카테고리들
        if (!element) {
            return this.getRootNodes();
        }

        // 카테고리별 하위 노드
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
                        title: 'Jira 열기',
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

        // 상태 그룹 하위: 이슈 목록
        if (element.nodeType === 'statusGroup' && element.meta?.['issues']) {
            return this.issueListToNodes(element.meta['issues'] as JiraIssueListItem[]);
        }

        return [];
    }

    // ─── 루트 노드 ───

    private getRootNodes(): JiraTreeItem[] {
        const nodes: JiraTreeItem[] = [];

        // 1) 플랫폼 선택 (항상 표시)
        const platformNode = this.buildPlatformNode();
        nodes.push(platformNode);

        // 2) 로그인 상태
        const statusNode = this.buildStatusNode();
        nodes.push(statusNode);

        if (this.connectionManager.isConnected) {
            // 3) 내 이슈
            const myIssues = new JiraTreeItem(
                localize('tree.myIssues'),
                vscode.TreeItemCollapsibleState.Expanded,
                'category',
                { childType: 'myIssues' },
            );
            nodes.push(myIssues);

            // 4) 내 필터
            const myFilters = new JiraTreeItem(
                localize('tree.myFilters'),
                vscode.TreeItemCollapsibleState.Collapsed,
                'category',
                { childType: 'myFilters' },
            );
            nodes.push(myFilters);

            // 5) JQL 검색
            const searchNode = new JiraTreeItem(
                localize('tree.jqlSearch'),
                this._searchResults.length > 0
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None,
                'action',
                { childType: 'searchResults' },
            );
            searchNode.command = {
                command: 'universal-agent.searchJql',
                title: localize('tree.jqlSearch'),
            };
            if (this._searchResults.length > 0) {
                searchNode.description = `${this._searchLabel} (${this._searchResults.length}건)`;
            }
            nodes.push(searchNode);
        }

        // 6) 추적 세션 (연결 여부와 무관하게 표시)
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

    // ─── 로그인 상태 노드 ───

    /**
     * 현재 선택된 플랫폼을 보여주는 노드.
     * 클릭 시 Quick Pick으로 플랫폼을 변경할 수 있다.
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
        node.tooltip = '클릭하여 플랫폼을 변경합니다';
        node.command = {
            command: 'universal-agent.selectPlatform',
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

        // 미연결 — 로그인 유도
        const node = new JiraTreeItem(
            localize('tree.login.action'),
            vscode.TreeItemCollapsibleState.None,
            'status',
        );
        node.description = localize('tree.status.loggedOut');
        node.tooltip = '클릭하여 로그인합니다';
        node.iconPath = new vscode.ThemeIcon('sign-in');
        node.command = {
            command: 'universal-agent.login',
            title: 'Sign In',
        };
        return node;
    }

    // ─── 내 이슈 (상태별 그룹) ───

    private async getMyIssueGroups(): Promise<JiraTreeItem[]> {
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const issues = await adapter.searchByJql(
                'assignee = currentUser() AND statusCategory != "Done" ORDER BY updated DESC',
                50,
            );

            // 최근 완료된 이슈도 표시 (7일 이내)
            const doneIssues = await adapter.searchByJql(
                'assignee = currentUser() AND statusCategory = "Done" AND updated >= -7d ORDER BY updated DESC',
                10,
            );

            // statusCategory별 그룹핑
            const groups = new Map<string, JiraIssueListItem[]>();
            for (const issue of issues) {
                const cat = issue.statusCategory || 'Unknown';
                if (!groups.has(cat)) { groups.set(cat, []); }
                groups.get(cat)!.push(issue);
            }
            if (doneIssues.length > 0) {
                groups.set('Done (최근 7일)', doneIssues);
            }

            // 상태 카테고리 아이콘 매핑
            const iconMap: Record<string, string> = {
                'To Do': '⬜',
                'In Progress': '🟡',
                'Done (최근 7일)': '✅',
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
                `⚠️ 이슈 조회 실패: ${err.message}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
            );
            return [errNode];
        }
    }

    // ─── 내 필터 ───

    private async getMyFilters(): Promise<JiraTreeItem[]> {
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);
            const filters = await adapter.getFavouriteFilters();

            if (filters.length === 0) {
                return [new JiraTreeItem(
                    '즐겨찾기 필터가 없습니다',
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
                    command: 'universal-agent.runFilter',
                    title: '필터 실행',
                    arguments: [f],
                };
                return node;
            });
        } catch (err: any) {
            return [new JiraTreeItem(
                `⚠️ 필터 조회 실패: ${err.message}`,
                vscode.TreeItemCollapsibleState.None,
                'status',
            )];
        }
    }

    // ─── 검색 결과 ───

    private getSearchResultNodes(): JiraTreeItem[] {
        if (this._searchResults.length === 0) {
            return [new JiraTreeItem(
                '검색 결과가 없습니다',
                vscode.TreeItemCollapsibleState.None,
                'status',
            )];
        }
        return this.issueListToNodes(this._searchResults);
    }

    // ─── 추적 세션 ───

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

    // ─── 이슈 → TreeItem 변환 ───

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
            node.tooltip = `${issue.key}: ${issue.summary}\n상태: ${issue.status}\n우선순위: ${issue.priority}\n담당자: ${issue.assignee ?? '미배정'}`;
            node.iconPath = new vscode.ThemeIcon('issues');
            node.command = {
                command: 'universal-agent.fetchIssue',
                title: '이슈 조회',
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
            default: return '⚫';
        }
    }
}
