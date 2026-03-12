import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraIssueData } from './adapters/JiraTrackerAdapter';
import { TrackerConfig } from './config';
import { MemoryManager } from './memory';

/**
 * 이슈 대시보드 Webview 패널.
 *
 * - 인스턴스를 이슈 키별로 캐싱하여 중복 패널 생성 방지
 * - 요약(AI Summary)은 workspaceState에 캐싱하여 재오픈 시 즉시 복원
 * - Extension ↔ Webview 메시지로 버튼 액션(추적 시작/종료, 새로고침) 처리
 */
export class DashboardPanel {
    // 패널 인스턴스 캐시 (issueKey → panel)
    private static readonly _panels = new Map<string, DashboardPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _issueKey: string;
    private _issueData: JiraIssueData | null = null;
    private _disposables: vscode.Disposable[] = [];

    // ── 생성자 (private) ──

    private constructor(
        private readonly _context: vscode.ExtensionContext,
        private readonly _config: TrackerConfig,
        private readonly _memoryManager: MemoryManager,
        issueKey: string,
    ) {
        this._issueKey = issueKey;

        this._panel = vscode.window.createWebviewPanel(
            'jiraIssueDashboard',
            `Jira: ${issueKey}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [],
            },
        );

        // 패널이 닫힐 때 캐시에서 제거
        this._panel.onDidDispose(
            () => {
                DashboardPanel._panels.delete(issueKey);
                this._dispose();
            },
            null,
            this._disposables,
        );

        // Webview → Extension 메시지 처리
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this._handleMessage(message),
            null,
            this._disposables,
        );

        // 로딩 상태로 초기 렌더링
        this._render(null, true);
    }

    // ── Public API ──

    /**
     * 대시보드 패널을 생성하거나 기존 패널을 활성화한다.
     * 이슈 데이터를 비동기로 로드 후 렌더링한다.
     */
    static async createOrShow(
        context: vscode.ExtensionContext,
        issueKey: string,
        config: TrackerConfig,
        memoryManager: MemoryManager,
    ): Promise<void> {
        const normalized = issueKey.trim().toUpperCase();

        // 기존 패널이 있으면 포커스만 이동
        const existing = DashboardPanel._panels.get(normalized);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // 신규 패널 생성
        const dashboard = new DashboardPanel(context, config, memoryManager, normalized);
        DashboardPanel._panels.set(normalized, dashboard);

        // 이슈 데이터 로드
        await dashboard._loadIssue();
    }

    // ── Private Methods ──

    /** Jira에서 이슈 데이터를 가져와 렌더링한다 */
    private async _loadIssue(): Promise<void> {
        try {
            const adapter = new JiraTrackerAdapter(this._config);
            this._issueData = await adapter.fetchJiraIssue(this._issueKey);
            this._render(this._issueData, false);
        } catch (err: any) {
            this._renderError(err.message ?? 'Unknown error');
        }
    }

    /** Webview에서 온 메시지를 처리한다 */
    private async _handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.command) {
            case 'refresh':
                this._render(this._issueData, true);
                await this._loadIssue();
                break;

            case 'startTracking':
                await vscode.commands.executeCommand(
                    'universal-agent.startTracking',
                    this._issueKey,
                );
                this._refreshTrackingState();
                break;

            case 'stopTracking':
                await vscode.commands.executeCommand('universal-agent.finishReport');
                this._refreshTrackingState();
                break;

            case 'openJira':
                vscode.env.openExternal(
                    vscode.Uri.parse(
                        `https://${this._config.domain}/browse/${this._issueKey}`,
                    ),
                );
                break;

            case 'generatePlan':
                await vscode.commands.executeCommand(
                    'universal-agent.generatePlan',
                );
                break;
        }
    }

    /** 추적 상태를 갱신하여 Webview에 보낸다 */
    private _refreshTrackingState(): void {
        const session = this._memoryManager.getSession();
        const isTracking = session?.issueKey === this._issueKey;
        const stats = this._memoryManager.getStats();

        this._panel.webview.postMessage({
            command: 'updateTracking',
            isTracking,
            fileCount: stats?.files ?? 0,
            terminalCount: stats?.terminal ?? 0,
        });
    }

    /** 대시보드 HTML을 렌더링한다 */
    private _render(data: JiraIssueData | null, loading: boolean): void {
        this._panel.webview.html = this._buildHtml(data, loading);
    }

    /** 에러 상태를 렌더링한다 */
    private _renderError(message: string): void {
        this._panel.webview.html = this._buildErrorHtml(message);
    }

    private _dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    // ── HTML 빌더 ──

    private _buildHtml(data: JiraIssueData | null, loading: boolean): string {
        const nonce = this._getNonce();
        const session = this._memoryManager.getSession();
        const isTracking = session?.issueKey === this._issueKey;
        const stats = this._memoryManager.getStats();

        const statusColor = this._getStatusColor(data?.status ?? '');
        const priorityIcon = this._getPriorityIcon(data?.priority ?? '');

        const cachedSummary: string =
            this._context.workspaceState.get(`summary_${this._issueKey}`) ?? '';

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Jira: ${this._issueKey}</title>
<style nonce="${nonce}">
  :root {
    --radius: 8px;
    --gap: 16px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: var(--gap);
    line-height: 1.6;
  }
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap);
    margin-bottom: var(--gap);
    flex-wrap: wrap;
  }
  .issue-key {
    font-size: 22px;
    font-weight: 700;
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
  }
  .issue-key:hover { text-decoration: underline; }
  .summary-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--vscode-foreground);
    margin-top: 4px;
    flex: 1;
    min-width: 200px;
  }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    background: ${statusColor};
    color: #fff;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--gap);
    margin-bottom: var(--gap);
  }
  .card {
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.1));
    border-radius: var(--radius);
    padding: var(--gap);
  }
  .card-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 10px;
  }
  .meta-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 12px;
  }
  .meta-label { color: var(--vscode-descriptionForeground); }
  .meta-value { font-weight: 500; }
  .tracking-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 10px;
  }
  .tracking-badge.active { background: rgba(255, 80, 80, 0.15); color: #ff5050; border: 1px solid #ff5050; }
  .tracking-badge.inactive { background: rgba(255,255,255,0.04); color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
  .stat { font-size: 18px; font-weight: 700; }
  .stat-label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .stats-row { display: flex; gap: 20px; margin-top: 8px; }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: var(--gap);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-secondary { background: transparent; color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border-color: var(--vscode-panel-border); }
  .btn-danger { background: rgba(220,53,69,0.15); color: #ff6b6b; border-color: #ff6b6b; }
  .description {
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius);
    padding: var(--gap);
    margin-bottom: var(--gap);
    white-space: pre-wrap;
    font-size: 13px;
    max-height: 300px;
    overflow-y: auto;
    line-height: 1.7;
  }
  .section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 200px;
    gap: 10px;
    color: var(--vscode-descriptionForeground);
  }
  .spinner {
    width: 20px; height: 20px;
    border: 2px solid var(--vscode-panel-border);
    border-top-color: var(--vscode-button-background);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .comment {
    padding: 10px;
    border-left: 3px solid var(--vscode-panel-border);
    margin-bottom: 8px;
    font-size: 12px;
  }
  .comment-author { font-weight: 600; color: var(--vscode-textLink-foreground); }
  .comment-date { color: var(--vscode-descriptionForeground); font-size: 11px; }
</style>
</head>
<body>
${loading ? `<div class="loading"><div class="spinner"></div> 이슈 로딩 중...</div>` : this._buildBody(data, isTracking, stats, priorityIcon, cachedSummary)}

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  function send(command, extra) {
    vscode.postMessage({ command, ...extra });
  }

  // Extension에서 오는 메시지 처리
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'updateTracking') {
      const badge = document.getElementById('tracking-badge');
      const statsDiv = document.getElementById('tracking-stats');
      if (badge) {
        badge.className = 'tracking-badge ' + (msg.isTracking ? 'active' : 'inactive');
        badge.innerHTML = msg.isTracking
          ? '🔴 추적 중 (Tracking Active)'
          : '⚫ 추적 안 함';
      }
      if (statsDiv) {
        statsDiv.innerHTML = msg.isTracking
          ? \`<div class="stats-row">
              <div><div class="stat">\${msg.fileCount}</div><div class="stat-label">파일 변경</div></div>
              <div><div class="stat">\${msg.terminalCount}</div><div class="stat-label">터미널 실행</div></div>
            </div>\`
          : '';
      }
    }
  });
</script>
</body>
</html>`;
    }

    private _buildBody(
        data: JiraIssueData | null,
        isTracking: boolean,
        stats: any,
        priorityIcon: string,
        cachedSummary: string,
    ): string {
        if (!data) {
            return `<div class="loading">이슈 데이터를 불러오지 못했습니다.</div>`;
        }

        const description = data.description
            ? this._escapeHtml(data.description.slice(0, 2000)) + (data.description.length > 2000 ? '\n...(이하 생략)' : '')
            : '(설명 없음)';

        const commentsHtml = data.comments.slice(0, 5).map(c => `
          <div class="comment">
            <div class="comment-author">${this._escapeHtml(c.author)} <span class="comment-date">${new Date(c.created).toLocaleString()}</span></div>
            <div>${this._escapeHtml(c.body?.slice(0, 300) ?? '')}</div>
          </div>
        `).join('');

        return `
<div class="header">
  <div>
    <a class="issue-key" onclick="send('openJira')">${data.key}</a>
    <div class="summary-title">${this._escapeHtml(data.summary)}</div>
  </div>
  <span class="badge">${this._escapeHtml(data.status)}</span>
</div>

<div class="actions">
  <button class="btn-primary" onclick="send('refresh')">🔄 새로고침</button>
  ${isTracking
    ? `<button class="btn-danger" onclick="send('stopTracking')">⏹️ 추적 종료 & 리포트</button>`
    : `<button class="btn-secondary" onclick="send('startTracking')">▶️ 추적 시작</button>`}
  <button class="btn-secondary" onclick="send('generatePlan')">📋 작업 계획서</button>
  <button class="btn-secondary" onclick="send('openJira')">🔗 Jira에서 열기</button>
</div>

<div class="grid">
  <div class="card">
    <div class="card-title">메타데이터</div>
    <div class="meta-row"><span class="meta-label">유형</span><span class="meta-value">${this._escapeHtml(data.issueType)}</span></div>
    <div class="meta-row"><span class="meta-label">우선순위</span><span class="meta-value">${priorityIcon} ${this._escapeHtml(data.priority)}</span></div>
    <div class="meta-row"><span class="meta-label">담당자</span><span class="meta-value">${this._escapeHtml(data.assignee ?? '미지정')}</span></div>
    <div class="meta-row"><span class="meta-label">보고자</span><span class="meta-value">${this._escapeHtml(data.reporter ?? '-')}</span></div>
    ${data.labels.length > 0 ? `<div class="meta-row"><span class="meta-label">레이블</span><span class="meta-value">${data.labels.map(l => this._escapeHtml(l)).join(', ')}</span></div>` : ''}
    ${data.components?.length ? `<div class="meta-row"><span class="meta-label">컴포넌트</span><span class="meta-value">${data.components.map(c => this._escapeHtml(c)).join(', ')}</span></div>` : ''}
    ${data.fixVersions?.length ? `<div class="meta-row"><span class="meta-label">Fix Version</span><span class="meta-value">${data.fixVersions.map(v => this._escapeHtml(v)).join(', ')}</span></div>` : ''}
    ${data.sprint ? `<div class="meta-row"><span class="meta-label">스프린트</span><span class="meta-value">${this._escapeHtml(data.sprint)}</span></div>` : ''}
  </div>

  <div class="card">
    <div class="card-title">작업 추적</div>
    <div id="tracking-badge" class="tracking-badge ${isTracking ? 'active' : 'inactive'}">
      ${isTracking ? '🔴 추적 중 (Tracking Active)' : '⚫ 추적 안 함'}
    </div>
    <div id="tracking-stats">
      ${isTracking ? `
      <div class="stats-row">
        <div><div class="stat">${stats?.files ?? 0}</div><div class="stat-label">파일 변경</div></div>
        <div><div class="stat">${stats?.terminal ?? 0}</div><div class="stat-label">터미널 실행</div></div>
        <div><div class="stat">${stats?.chats ?? 0}</div><div class="stat-label">AI 대화</div></div>
      </div>` : ''}
    </div>
  </div>

  ${data.epic ? `
  <div class="card">
    <div class="card-title">에픽</div>
    <div class="meta-row"><span class="meta-label">키</span><span class="meta-value">${this._escapeHtml(data.epic.key)}</span></div>
    <div class="meta-row"><span class="meta-label">요약</span><span class="meta-value">${this._escapeHtml(data.epic.summary)}</span></div>
  </div>` : ''}
</div>

${cachedSummary ? `
<div class="section-title">🤖 AI 요약 (캐시)</div>
<div class="description">${this._escapeHtml(cachedSummary)}</div>
` : ''}

<div class="section-title">📝 설명</div>
<div class="description">${description}</div>

${data.comments.length > 0 ? `
<div class="section-title">💬 최근 댓글 (${data.comments.length}건)</div>
${commentsHtml}
` : ''}

${data.linkedIssues.length > 0 ? `
<div class="section-title">🔗 연관 이슈 (${data.linkedIssues.length}건)</div>
${data.linkedIssues.slice(0, 5).map(li => `
<div class="comment">
  <div class="comment-author">${this._escapeHtml(li.linkType)}: ${this._escapeHtml(li.key)}</div>
  <div>${this._escapeHtml(li.summary)}</div>
</div>`).join('')}
` : ''}

${data.subtasks.length > 0 ? `
<div class="section-title">📌 하위 이슈 (${data.subtasks.length}건)</div>
${data.subtasks.map(st => `
<div class="comment">
  <div class="comment-author">${this._escapeHtml(st.key)} <span class="comment-date">${this._escapeHtml(st.status)}</span></div>
  <div>${this._escapeHtml(st.summary)}</div>
</div>`).join('')}
` : ''}
`;
    }

    private _buildErrorHtml(message: string): string {
        const nonce = this._getNonce();
        return /* html */ `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
  body { font-family: sans-serif; color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 24px; }
  .error { color: #ff6b6b; }
  .error-msg { margin-top: 8px; }
  button { margin-top: 16px; padding: 6px 14px; cursor: pointer; }
</style>
</head><body>
<h2 class="error">⚠️ 이슈 로드 실패</h2>
<p class="error-msg">${this._escapeHtml(message)}</p>
<script nonce="${nonce}">const vscode = acquireVsCodeApi();</script>
<button onclick="vscode.postMessage({command:'refresh'})">다시 시도</button>
</body></html>`;
    }

    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private _escapeHtml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private _getStatusColor(status: string): string {
        const s = status.toLowerCase();
        if (s.includes('done') || s.includes('완료')) { return '#28a745'; }
        if (s.includes('progress') || s.includes('진행')) { return '#007bff'; }
        if (s.includes('review') || s.includes('검토')) { return '#fd7e14'; }
        if (s.includes('block') || s.includes('차단')) { return '#dc3545'; }
        return '#6c757d';
    }

    private _getPriorityIcon(priority: string): string {
        const p = priority.toLowerCase();
        if (p === 'highest' || p === 'critical') { return '🔴'; }
        if (p === 'high') { return '🟠'; }
        if (p === 'medium') { return '🟡'; }
        if (p === 'low') { return '🟢'; }
        if (p === 'lowest') { return '⚪'; }
        return '⬜';
    }
}

// ── 메시지 타입 ──

interface WebviewMessage {
    command: 'refresh' | 'startTracking' | 'stopTracking' | 'openJira' | 'generatePlan';
}
