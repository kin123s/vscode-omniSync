import * as vscode from 'vscode';
import { JiraTrackerAdapter, JiraIssueData } from './adapters/JiraTrackerAdapter';
import { TrackerConfig } from './config';
import { MemoryManager } from './memory';

/**
 * ?댁뒋 ??쒕낫??Webview ?⑤꼸.
 *
 * - ?몄뒪?댁뒪瑜??댁뒋 ?ㅻ퀎濡?罹먯떛?섏뿬 以묐났 ?⑤꼸 ?앹꽦 諛⑹?
 * - ?붿빟(AI Summary)? workspaceState??罹먯떛?섏뿬 ?ъ삤????利됱떆 蹂듭썝
 * - Extension ??Webview 硫붿떆吏濡?踰꾪듉 ?≪뀡(異붿쟻 ?쒖옉/醫낅즺, ?덈줈怨좎묠) 泥섎━
 */
export class DashboardPanel {
    // ?⑤꼸 ?몄뒪?댁뒪 罹먯떆 (issueKey ??panel)
    private static readonly _panels = new Map<string, DashboardPanel>();

    private readonly _panel: vscode.WebviewPanel;
    private readonly _issueKey: string;
    private _issueData: JiraIssueData | null = null;
    private _disposables: vscode.Disposable[] = [];

    // ?? ?앹꽦??(private) ??

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

        // ?⑤꼸???ロ옄 ??罹먯떆?먯꽌 ?쒓굅
        this._panel.onDidDispose(
            () => {
                DashboardPanel._panels.delete(issueKey);
                this._dispose();
            },
            null,
            this._disposables,
        );

        // Webview ??Extension 硫붿떆吏 泥섎━
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this._handleMessage(message),
            null,
            this._disposables,
        );

        // 濡쒕뵫 ?곹깭濡?珥덇린 ?뚮뜑留?
        this._render(null, true);
    }

    // ?? Public API ??

    /**
     * ??쒕낫???⑤꼸???앹꽦?섍굅??湲곗〈 ?⑤꼸???쒖꽦?뷀븳??
     * ?댁뒋 ?곗씠?곕? 鍮꾨룞湲곕줈 濡쒕뱶 ???뚮뜑留곹븳??
     */
    static async createOrShow(
        context: vscode.ExtensionContext,
        issueKey: string,
        config: TrackerConfig,
        memoryManager: MemoryManager,
    ): Promise<void> {
        const normalized = issueKey.trim().toUpperCase();

        // 湲곗〈 ?⑤꼸???덉쑝硫??ъ빱?ㅻ쭔 ?대룞
        const existing = DashboardPanel._panels.get(normalized);
        if (existing) {
            existing._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // ?좉퇋 ?⑤꼸 ?앹꽦
        const dashboard = new DashboardPanel(context, config, memoryManager, normalized);
        DashboardPanel._panels.set(normalized, dashboard);

        // ?댁뒋 ?곗씠??濡쒕뱶
        await dashboard._loadIssue();
    }

    // ?? Private Methods ??

    /** Jira?먯꽌 ?댁뒋 ?곗씠?곕? 媛?몄? ?뚮뜑留곹븳??*/
    private async _loadIssue(): Promise<void> {
        try {
            const adapter = new JiraTrackerAdapter(this._config);
            this._issueData = await adapter.fetchJiraIssue(this._issueKey);
            this._render(this._issueData, false);
        } catch (err: any) {
            this._renderError(err.message ?? 'Unknown error');
        }
    }

    /** Webview?먯꽌 ??硫붿떆吏瑜?泥섎━?쒕떎 */
    private async _handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.command) {
            case 'refresh':
                this._render(this._issueData, true);
                await this._loadIssue();
                break;

            case 'startTracking':
                await vscode.commands.executeCommand(
                    'orx.startTracking',
                    this._issueKey,
                );
                this._refreshTrackingState();
                break;

            case 'stopTracking':
                await vscode.commands.executeCommand('orx.finishReport');
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
                    'orx.generatePlan',
                );
                break;
        }
    }

    /** 異붿쟻 ?곹깭瑜?媛깆떊?섏뿬 Webview??蹂대궦??*/
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

    /** ??쒕낫??HTML???뚮뜑留곹븳??*/
    private _render(data: JiraIssueData | null, loading: boolean): void {
        this._panel.webview.html = this._buildHtml(data, loading);
    }

    /** ?먮윭 ?곹깭瑜??뚮뜑留곹븳??*/
    private _renderError(message: string): void {
        this._panel.webview.html = this._buildErrorHtml(message);
    }

    private _dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }

    // ?? HTML 鍮뚮뜑 ??

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
${loading ? `<div class="loading"><div class="spinner"></div> ?댁뒋 濡쒕뵫 以?..</div>` : this._buildBody(data, isTracking, stats, priorityIcon, cachedSummary)}

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  function send(command, extra) {
    vscode.postMessage({ command, ...extra });
  }

  // Extension?먯꽌 ?ㅻ뒗 硫붿떆吏 泥섎━
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'updateTracking') {
      const badge = document.getElementById('tracking-badge');
      const statsDiv = document.getElementById('tracking-stats');
      if (badge) {
        badge.className = 'tracking-badge ' + (msg.isTracking ? 'active' : 'inactive');
        badge.innerHTML = msg.isTracking
          ? '?뵶 異붿쟻 以?(Tracking Active)'
          : '??異붿쟻 ????;
      }
      if (statsDiv) {
        statsDiv.innerHTML = msg.isTracking
          ? \`<div class="stats-row">
              <div><div class="stat">\${msg.fileCount}</div><div class="stat-label">?뚯씪 蹂寃?/div></div>
              <div><div class="stat">\${msg.terminalCount}</div><div class="stat-label">?곕????ㅽ뻾</div></div>
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
            return `<div class="loading">?댁뒋 ?곗씠?곕? 遺덈윭?ㅼ? 紐삵뻽?듬땲??</div>`;
        }

        const description = data.description
            ? this._escapeHtml(data.description.slice(0, 2000)) + (data.description.length > 2000 ? '\n...(?댄븯 ?앸왂)' : '')
            : '(?ㅻ챸 ?놁쓬)';

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
  <button class="btn-primary" onclick="send('refresh')">?봽 ?덈줈怨좎묠</button>
  ${isTracking
    ? `<button class="btn-danger" onclick="send('stopTracking')">?뱄툘 異붿쟻 醫낅즺 & 由ы룷??/button>`
    : `<button class="btn-secondary" onclick="send('startTracking')">?띰툘 異붿쟻 ?쒖옉</button>`}
  <button class="btn-secondary" onclick="send('generatePlan')">?뱥 ?묒뾽 怨꾪쉷??/button>
  <button class="btn-secondary" onclick="send('openJira')">?뵕 Jira?먯꽌 ?닿린</button>
</div>

<div class="grid">
  <div class="card">
    <div class="card-title">硫뷀??곗씠??/div>
    <div class="meta-row"><span class="meta-label">?좏삎</span><span class="meta-value">${this._escapeHtml(data.issueType)}</span></div>
    <div class="meta-row"><span class="meta-label">?곗꽑?쒖쐞</span><span class="meta-value">${priorityIcon} ${this._escapeHtml(data.priority)}</span></div>
    <div class="meta-row"><span class="meta-label">?대떦??/span><span class="meta-value">${this._escapeHtml(data.assignee ?? '誘몄???)}</span></div>
    <div class="meta-row"><span class="meta-label">蹂닿퀬??/span><span class="meta-value">${this._escapeHtml(data.reporter ?? '-')}</span></div>
    ${data.labels.length > 0 ? `<div class="meta-row"><span class="meta-label">?덉씠釉?/span><span class="meta-value">${data.labels.map(l => this._escapeHtml(l)).join(', ')}</span></div>` : ''}
    ${data.components?.length ? `<div class="meta-row"><span class="meta-label">而댄룷?뚰듃</span><span class="meta-value">${data.components.map(c => this._escapeHtml(c)).join(', ')}</span></div>` : ''}
    ${data.fixVersions?.length ? `<div class="meta-row"><span class="meta-label">Fix Version</span><span class="meta-value">${data.fixVersions.map(v => this._escapeHtml(v)).join(', ')}</span></div>` : ''}
    ${data.sprint ? `<div class="meta-row"><span class="meta-label">?ㅽ봽由고듃</span><span class="meta-value">${this._escapeHtml(data.sprint)}</span></div>` : ''}
  </div>

  <div class="card">
    <div class="card-title">?묒뾽 異붿쟻</div>
    <div id="tracking-badge" class="tracking-badge ${isTracking ? 'active' : 'inactive'}">
      ${isTracking ? '?뵶 異붿쟻 以?(Tracking Active)' : '??異붿쟻 ????}
    </div>
    <div id="tracking-stats">
      ${isTracking ? `
      <div class="stats-row">
        <div><div class="stat">${stats?.files ?? 0}</div><div class="stat-label">?뚯씪 蹂寃?/div></div>
        <div><div class="stat">${stats?.terminal ?? 0}</div><div class="stat-label">?곕????ㅽ뻾</div></div>
        <div><div class="stat">${stats?.chats ?? 0}</div><div class="stat-label">AI ???/div></div>
      </div>` : ''}
    </div>
  </div>

  ${data.epic ? `
  <div class="card">
    <div class="card-title">?먰뵿</div>
    <div class="meta-row"><span class="meta-label">??/span><span class="meta-value">${this._escapeHtml(data.epic.key)}</span></div>
    <div class="meta-row"><span class="meta-label">?붿빟</span><span class="meta-value">${this._escapeHtml(data.epic.summary)}</span></div>
  </div>` : ''}
</div>

${cachedSummary ? `
<div class="section-title">?쨼 AI ?붿빟 (罹먯떆)</div>
<div class="description">${this._escapeHtml(cachedSummary)}</div>
` : ''}

<div class="section-title">?뱷 ?ㅻ챸</div>
<div class="description">${description}</div>

${data.comments.length > 0 ? `
<div class="section-title">?뮠 理쒓렐 ?볤? (${data.comments.length}嫄?</div>
${commentsHtml}
` : ''}

${data.linkedIssues.length > 0 ? `
<div class="section-title">?뵕 ?곌? ?댁뒋 (${data.linkedIssues.length}嫄?</div>
${data.linkedIssues.slice(0, 5).map(li => `
<div class="comment">
  <div class="comment-author">${this._escapeHtml(li.linkType)}: ${this._escapeHtml(li.key)}</div>
  <div>${this._escapeHtml(li.summary)}</div>
</div>`).join('')}
` : ''}

${data.subtasks.length > 0 ? `
<div class="section-title">?뱦 ?섏쐞 ?댁뒋 (${data.subtasks.length}嫄?</div>
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
<h2 class="error">?좑툘 ?댁뒋 濡쒕뱶 ?ㅽ뙣</h2>
<p class="error-msg">${this._escapeHtml(message)}</p>
<script nonce="${nonce}">const vscode = acquireVsCodeApi();</script>
<button onclick="vscode.postMessage({command:'refresh'})">?ㅼ떆 ?쒕룄</button>
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
        if (s.includes('done') || s.includes('?꾨즺')) { return '#28a745'; }
        if (s.includes('progress') || s.includes('吏꾪뻾')) { return '#007bff'; }
        if (s.includes('review') || s.includes('寃??)) { return '#fd7e14'; }
        if (s.includes('block') || s.includes('李⑤떒')) { return '#dc3545'; }
        return '#6c757d';
    }

    private _getPriorityIcon(priority: string): string {
        const p = priority.toLowerCase();
        if (p === 'highest' || p === 'critical') { return '?뵶'; }
        if (p === 'high') { return '?윝'; }
        if (p === 'medium') { return '?윞'; }
        if (p === 'low') { return '?윟'; }
        if (p === 'lowest') { return '??; }
        return '燧?;
    }
}

// ?? 硫붿떆吏 ?????

interface WebviewMessage {
    command: 'refresh' | 'startTracking' | 'stopTracking' | 'openJira' | 'generatePlan';
}
