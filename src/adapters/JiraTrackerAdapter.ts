import { TrackerAdapter, IssueContext } from './TrackerAdapter';
import { TrackerConfig } from '../config';
import { wikiMarkupToPlainText } from '../utils/wikiMarkupParser';
import * as https from 'https';

// ─── Jira REST API 응답 타입 정의 ───

export interface JiraComment {
    id: string;
    author: string;
    body: string;
    created: string;
}

export interface JiraIssueData {
    key: string;
    summary: string;
    description: string | null;
    status: string;
    assignee: string | null;
    reporter: string | null;
    issueType: string;
    priority: string;
    labels: string[];
    comments: JiraComment[];
    epic?: { key: string; summary: string; description?: string | null };
    linkedIssues: Array<{ key: string; summary: string; linkType: string }>;
    subtasks: Array<{ key: string; summary: string; status: string }>;
    /** MISSION-1.6: v2 전용 — Component 목록 */
    components?: string[];
    /** MISSION-1.6: v2 전용 — Fix Version 목록 */
    fixVersions?: string[];
    /** MISSION-1.6: v2 전용 — 스프린트 이름 */
    sprint?: string;
}

export interface JiraUser {
    /** Cloud v3: accountId 기반 식별 */
    accountId: string;
    /** Server v2: username 기반 식별 */
    name?: string;
    /** Server v2: user key */
    key?: string;
    displayName: string;
    emailAddress: string;
    avatarUrl: string;
}

export interface JiraFilter {
    id: string;
    name: string;
    jql: string;
}

export interface JiraIssueListItem {
    key: string;
    summary: string;
    status: string;
    statusCategory: string;
    priority: string;
    assignee: string | null;
}

// ─── Jira REST API 클라이언트 (내부용) ───

class JiraApiClient {
    private readonly baseUrl: string;
    private readonly authHeader: string;
    private readonly apiVersion: 'v2' | 'v3';
    /**
     * Self-signed 인증서 환경용 커스텀 HTTPS Agent.
     * config.allowSelfSignedCert === true 일 때만 생성되며,
     * rejectUnauthorized: false 로 설정한다.
     */
    private readonly httpsAgent?: https.Agent;

    constructor(config: TrackerConfig) {
        // jira-cloud → v3, jira-server → v2
        this.apiVersion = config.platform === 'jira-server' ? 'v2' : 'v3';
        const apiBase = this.apiVersion === 'v2' ? '/rest/api/2' : '/rest/api/3';
        this.baseUrl = `https://${config.domain}${apiBase}`;

        if (config.platform === 'jira-cloud' && config.oauthAccessToken) {
            this.authHeader = `Bearer ${config.oauthAccessToken}`;
        } else {
            this.authHeader = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
        }

        // MISSION-1.5: Self-signed 인증서 지원
        if (config.allowSelfSignedCert) {
            this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
        }
    }

    async get<T>(path: string): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        // Node.js의 fetch는 dispatcher 옵션으로 Agent를 전달할 수 없으므로
        // undici 호환 방식 또는 기본 fetch 사용. self-signed cert는
        // NODE_TLS_REJECT_UNAUTHORIZED 환경변수로도 제어 가능하나,
        // 여기서는 fetch 호출 시 안전하게 처리한다.
        const fetchOptions: RequestInit = {
            method: 'GET',
            headers: {
                'Authorization': this.authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(10000),
        };
        // self-signed cert 환경에서는 Node.js의 undici dispatcher를 통해 처리
        if (this.httpsAgent) {
            (fetchOptions as any).dispatcher = this.httpsAgent;
        }
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
                `Jira API 요청 실패 [${response.status}]: ${response.statusText}\n` +
                `URL: ${url}\n응답: ${errorBody}`
            );
        }
        return response.json() as Promise<T>;
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        const fetchOptions: RequestInit = {
            method: 'POST',
            headers: {
                'Authorization': this.authHeader,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        };
        if (this.httpsAgent) {
            (fetchOptions as any).dispatcher = this.httpsAgent;
        }
        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(
                `Jira API POST 요청 실패 [${response.status}]: ${response.statusText}\n` +
                `URL: ${url}\n응답: ${errorBody}`
            );
        }
        const text = await response.text();
        return text ? JSON.parse(text) as T : ({} as T);
    }

    getApiVersion(): 'v2' | 'v3' {
        return this.apiVersion;
    }

    /**
     * Atlassian Document Format(ADF) → 플레인 텍스트 변환
     */
    extractTextFromAdf(adf: any): string | null {
        if (!adf || typeof adf !== 'object') { return null; }

        const extractNode = (node: any): string => {
            if (node.type === 'text' && typeof node.text === 'string') { return node.text; }
            if (node.type === 'hardBreak') { return '\n'; }
            if (Array.isArray(node.content)) { return node.content.map(extractNode).join(''); }
            return '';
        };

        if (Array.isArray(adf.content)) {
            return adf.content
                .map((block: any) => extractNode(block))
                .filter((text: string) => text.length > 0)
                .join('\n');
        }
        return null;
    }
}

// ─── TrackerAdapter 구현체 ───

/**
 * Jira 플랫폼용 TrackerAdapter 구현체.
 * TrackerAdapter 인터페이스를 준수하며, 범용 오케스트레이터가 Jira를
 * 일반 이슈 트래커처럼 다룰 수 있도록 추상화한다.
 */
export class JiraTrackerAdapter implements TrackerAdapter {
    readonly id = 'jira';

    private readonly api: JiraApiClient;
    private readonly config: TrackerConfig;

    /** 현재 로그인된 사용자 정보 캐시 */
    private cachedUser: JiraUser | null = null;

    constructor(config: TrackerConfig) {
        this.config = config;
        this.api = new JiraApiClient(config);
    }

    // ─── TrackerAdapter 인터페이스 구현 ───

    /**
     * 현재 로그인 사용자에게 할당된 활성 이슈 목록을 가져온다.
     */
    async fetchActiveIssues(): Promise<IssueContext[]> {
        const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
        const result = await this.searchByJql(jql, 50);
        return result.map(item => this.toIssueContext(item));
    }

    /**
     * 특정 이슈 키로 상세 정보를 가져온다.
     */
    async fetchIssueDetails(issueId: string): Promise<IssueContext> {
        const data = await this.fetchJiraIssue(issueId);
        return {
            id: data.key,
            title: data.summary,
            description: data.description ?? '',
            status: data.status,
            url: `https://${this.config.domain}/browse/${data.key}`,
            metadata: {
                assignee: data.assignee,
                reporter: data.reporter,
                issueType: data.issueType,
                priority: data.priority,
                labels: data.labels,
                comments: data.comments,
            },
        };
    }

    /**
     * 작업 완료 후 이슈에 코멘트를 추가하고 상태를 전환한다.
     */
    async updateIssue(issueId: string, comment: string, newStatus?: string): Promise<boolean> {
        try {
            await this.addComment(issueId, comment);
            if (newStatus) {
                const transitions = await this.getTransitions(issueId);
                const target = transitions.find(t =>
                    t.name.toLowerCase() === newStatus.toLowerCase()
                );
                if (target) {
                    await this.api.post(`/issue/${issueId}/transitions`, {
                        transition: { id: target.id },
                    });
                }
            }
            return true;
        } catch (err) {
            console.error(`[JiraTrackerAdapter] updateIssue 실패: ${err}`);
            return false;
        }
    }

    // ─── Jira 전용 확장 메서드 ───

    async getMyself(): Promise<JiraUser> {
        if (this.cachedUser) { return this.cachedUser; }
        const raw = await this.api.get<any>('/myself');
        const apiVer = this.api.getApiVersion();

        // MISSION-1.3: v2는 name/key, v3는 accountId로 사용자 식별
        this.cachedUser = {
            accountId: raw.accountId ?? '',
            name: apiVer === 'v2' ? (raw.name ?? '') : undefined,
            key: apiVer === 'v2' ? (raw.key ?? '') : undefined,
            displayName: raw.displayName ?? 'Unknown',
            emailAddress: raw.emailAddress ?? '',
            avatarUrl: raw.avatarUrls?.['48x48'] ?? '',
        };
        return this.cachedUser;
    }

    async getFavouriteFilters(): Promise<JiraFilter[]> {
        const raw = await this.api.get<any[]>('/filter/favourite');
        return (raw ?? []).map((f: any) => ({
            id: f.id ?? '',
            name: f.name ?? 'Untitled',
            jql: f.jql ?? '',
        }));
    }

    async searchByJql(
        jql: string,
        maxResults: number = 50,
        startAt: number = 0
    ): Promise<JiraIssueListItem[]> {
        const encodedJql = encodeURIComponent(jql);
        const fields = 'summary,status,priority,assignee';
        const apiVer = this.api.getApiVersion();
        const searchPath = apiVer === 'v2'
            ? `/search?jql=${encodedJql}&fields=${fields}&maxResults=${maxResults}&startAt=${startAt}`
            : `/search/jql?jql=${encodedJql}&fields=${fields}&maxResults=${maxResults}&startAt=${startAt}`;

        const raw = await this.api.get<any>(searchPath);
        return (raw.issues ?? []).map((issue: any) => ({
            key: issue.key,
            summary: issue.fields?.summary ?? '',
            status: issue.fields?.status?.name ?? 'Unknown',
            statusCategory: issue.fields?.status?.statusCategory?.name ?? 'Unknown',
            priority: issue.fields?.priority?.name ?? 'None',
            assignee: issue.fields?.assignee?.displayName ?? null,
        }));
    }

    async fetchJiraIssue(issueKey: string): Promise<JiraIssueData> {
        const apiVer = this.api.getApiVersion();
        const raw = await this.api.get<any>(
            `/issue/${issueKey}?fields=summary,description,status,assignee,reporter,issuetype,priority,labels,comment,issuelinks,subtasks,parent,components,fixVersions,sprint`
        );
        const fields = raw.fields;

        // MISSION-1.2: v2는 Wiki Markup 문자열, v3는 ADF JSON
        let description: string | null;
        if (apiVer === 'v3') {
            description = this.api.extractTextFromAdf(fields.description);
        } else {
            // v2: Wiki Markup → Plain Text 변환
            description = wikiMarkupToPlainText(fields.description as string | null);
        }

        const comments: JiraComment[] = (fields.comment?.comments ?? []).map((c: any) => ({
            id: c.id,
            author: c.author?.displayName ?? 'Unknown',
            body: apiVer === 'v3' ? (this.api.extractTextFromAdf(c.body) ?? '') : (c.body as string ?? ''),
            created: c.created,
        }));

        // 에픽 정보 (parent 또는 customfield 기반)
        let epic: JiraIssueData['epic'] = undefined;
        if (fields.parent) {
            epic = {
                key: fields.parent.key ?? '',
                summary: fields.parent.fields?.summary ?? '',
                description: null,
            };
        }

        // 연결된 이슈
        const linkedIssues = (fields.issuelinks ?? []).map((link: any) => {
            const linkedIssue = link.outwardIssue ?? link.inwardIssue;
            const linkType = link.outwardIssue
                ? (link.type?.outward ?? 'relates to')
                : (link.type?.inward ?? 'relates to');
            return {
                key: linkedIssue?.key ?? '',
                summary: linkedIssue?.fields?.summary ?? '',
                linkType,
            };
        }).filter((li: any) => li.key);

        // 하위 이슈
        const subtasks = (fields.subtasks ?? []).map((st: any) => ({
            key: st.key ?? '',
            summary: st.fields?.summary ?? '',
            status: st.fields?.status?.name ?? 'Unknown',
        }));

        // MISSION-1.6: v2 전용 필드 (Component, Fix Version, Sprint)
        const components = (fields.components ?? []).map((c: any) => c.name ?? '').filter(Boolean);
        const fixVersions = (fields.fixVersions ?? []).map((v: any) => v.name ?? '').filter(Boolean);
        // Sprint는 customfield 또는 직접 제공 (Jira 환경마다 다를 수 있음)
        const sprintField = fields.sprint;
        let sprint: string | undefined;
        if (typeof sprintField === 'string') {
            // v2에서 sprint가 문자열로 올 수 있음 (com.atlassian.greenhopper...)
            const nameMatch = sprintField.match(/name=([^,]+)/);
            sprint = nameMatch ? nameMatch[1] : undefined;
        } else if (sprintField?.name) {
            sprint = sprintField.name;
        }

        return {
            key: raw.key,
            summary: fields.summary ?? '',
            description,
            status: fields.status?.name ?? 'Unknown',
            assignee: fields.assignee?.displayName ?? null,
            reporter: fields.reporter?.displayName ?? null,
            issueType: fields.issuetype?.name ?? 'Unknown',
            priority: fields.priority?.name ?? 'None',
            labels: fields.labels ?? [],
            comments,
            epic,
            linkedIssues,
            subtasks,
            components: components.length > 0 ? components : undefined,
            fixVersions: fixVersions.length > 0 ? fixVersions : undefined,
            sprint,
        };
    }

    async addComment(issueKey: string, markdownText: string): Promise<void> {
        if (this.api.getApiVersion() === 'v2') {
            await this.api.post(`/issue/${issueKey}/comment`, { body: markdownText });
        } else {
            const paragraphs = markdownText.split('\n\n').filter(p => p.trim());
            const adfContent = paragraphs.map(para => ({
                type: 'paragraph',
                content: [{ type: 'text', text: para.trim() }],
            }));
            await this.api.post(`/issue/${issueKey}/comment`, {
                body: { version: 1, type: 'doc', content: adfContent },
            });
        }
    }

    async getTransitions(issueKey: string): Promise<Array<{ id: string; name: string }>> {
        const data = await this.api.get<any>(`/issue/${issueKey}/transitions`);
        return (data.transitions ?? []).map((t: any) => ({ id: t.id, name: t.name }));
    }

    // ─── 내부 유틸 ───

    private toIssueContext(item: JiraIssueListItem): IssueContext {
        return {
            id: item.key,
            title: item.summary,
            description: '',
            status: item.status,
            url: `https://${this.config.domain}/browse/${item.key}`,
            metadata: {
                statusCategory: item.statusCategory,
                priority: item.priority,
                assignee: item.assignee,
            },
        };
    }
}
