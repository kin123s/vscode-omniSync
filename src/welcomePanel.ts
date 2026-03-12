import * as vscode from 'vscode';
import { getPlatform, TrackerPlatform } from './config';

/**
 * Welcome / 로그인 Webview 패널.
 *
 * - Step 1: 플랫폼 선택 (시각적 카드)
 * - Step 2: 선택한 플랫폼에 맞는 로그인 폼
 * - 싱글톤 패턴 — 동시에 하나의 패널만 존재
 */
export class WelcomePanel {
    private static _instance: WelcomePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        _context: vscode.ExtensionContext,
        private readonly _onConnect: () => void,
    ) {
        this._panel = vscode.window.createWebviewPanel(
            'universalAgent.welcome',
            'OmniSync — Connect',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
        );

        this._panel.iconPath = new vscode.ThemeIcon('plug');

        this._panel.onDidDispose(() => {
            WelcomePanel._instance = undefined;
            this._disposables.forEach(d => d.dispose());
        }, null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            msg => this._handleMessage(msg),
            null,
            this._disposables,
        );

        this._render();
    }

    /** 패널 열기 (이미 열려 있으면 포커스) */
    static createOrShow(context: vscode.ExtensionContext, onConnect: () => void): void {
        if (WelcomePanel._instance) {
            WelcomePanel._instance._panel.reveal(vscode.ViewColumn.One);
            return;
        }
        WelcomePanel._instance = new WelcomePanel(context, onConnect);
    }

    /** 외부에서 패널 닫기 */
    static close(): void {
        WelcomePanel._instance?._panel.dispose();
        WelcomePanel._instance = undefined;
    }

    // ── 메시지 핸들러 ──

    private async _handleMessage(msg: Record<string, string>): Promise<void> {
        switch (msg.command) {
            case 'selectPlatform': {
                const platform = msg.platform as TrackerPlatform;
                await vscode.workspace.getConfiguration('universalAgent').update(
                    'trackerPlatform', platform, vscode.ConfigurationTarget.Global,
                );
                // 선택 후 로그인 폼으로 전환
                this._render(platform);
                break;
            }

            case 'submitCredentials': {
                const config = vscode.workspace.getConfiguration('universalAgent');
                if (msg.domain) {
                    await config.update('trackerDomain', msg.domain, vscode.ConfigurationTarget.Global);
                }
                if (msg.email) {
                    await config.update('email', msg.email, vscode.ConfigurationTarget.Global);
                }
                if (msg.apiToken) {
                    await config.update('apiToken', msg.apiToken, vscode.ConfigurationTarget.Global);
                }

                vscode.window.showInformationMessage('✅ 연결 정보가 저장되었습니다. 연결을 확인합니다...');
                this._onConnect();
                WelcomePanel.close();
                break;
            }

            case 'oauthLogin': {
                await vscode.commands.executeCommand('universal-agent.login');
                break;
            }

            case 'back': {
                this._render(); // 플랫폼 선택으로 돌아가기
                break;
            }
        }
    }

    // ── 렌더링 ──

    private _render(selectedPlatform?: TrackerPlatform): void {
        const nonce = getNonce();
        const current = selectedPlatform ?? getPlatform();
        const showForm = !!selectedPlatform;

        this._panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>OmniSync — Connect</title>
<style nonce="${nonce}">
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-foreground);
    --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
    --card-border: var(--vscode-panel-border, rgba(255,255,255,0.1));
    --accent: var(--vscode-button-background, #0078d4);
    --accent-fg: var(--vscode-button-foreground, #fff);
    --muted: var(--vscode-descriptionForeground, #888);
    --input-bg: var(--vscode-input-background, #1e1e1e);
    --input-border: var(--vscode-input-border, #444);
    --input-fg: var(--vscode-input-foreground, #e6edf3);
    --radius: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family, 'Segoe UI', sans-serif);
    background: var(--bg);
    color: var(--fg);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .container {
    max-width: 560px;
    width: 100%;
  }
  .header {
    text-align: center;
    margin-bottom: 32px;
  }
  .header h1 {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 8px;
    background: linear-gradient(135deg, #58a6ff, #d2a8ff);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .header p {
    color: var(--muted);
    font-size: 13px;
  }
  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 24px;
  }
  .card {
    background: var(--card-bg);
    border: 2px solid var(--card-border);
    border-radius: var(--radius);
    padding: 20px 16px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }
  .card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  .card.selected {
    border-color: var(--accent);
    background: rgba(0, 120, 212, 0.08);
  }
  .card-icon {
    font-size: 32px;
    margin-bottom: 8px;
    display: block;
  }
  .card-title {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 4px;
  }
  .card-desc {
    font-size: 11px;
    color: var(--muted);
  }
  .card.disabled {
    opacity: 0.4;
    cursor: not-allowed;
    /* pointer-events: none; 제거하여 타이틀 클릭 시 안내 메시지 등을 원하면 설정, 현재는 단순 비활성화 */
  }
  .card.disabled .card-title::after {
    content: ' (준비 중)';
    font-weight: 400;
    color: var(--muted);
  }

  /* 로그인 폼 */
  .form-section { display: none; }
  .form-section.active { display: block; }
  .form-group {
    margin-bottom: 16px;
  }
  .form-group label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
  .form-group input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    background: var(--input-bg);
    color: var(--input-fg);
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
  }
  .form-group input:focus {
    border-color: var(--accent);
  }
  .form-group .hint {
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
  }

  .actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
  }
  button {
    flex: 1;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  .btn-primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .btn-secondary {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--card-border);
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 20px 0;
    color: var(--muted);
    font-size: 11px;
  }
  .divider::before, .divider::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--card-border);
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>OmniSync</h1>
    <p>${showForm ? '연결 정보를 입력하세요' : '연결할 플랫폼을 선택하세요'}</p>
  </div>

  <!-- Step 1: 플랫폼 선택 -->
  <div id="platform-select" class="form-section ${!showForm ? 'active' : ''}">
    <div class="cards">
      <div class="card ${current === 'jira-cloud' ? 'selected' : ''}" role="button" tabindex="0" onclick="selectPlatform('jira-cloud')" onkeydown="if(event.key==='Enter') selectPlatform('jira-cloud')">
        <span class="card-icon">🌐</span>
        <div class="card-title">Jira Cloud</div>
        <div class="card-desc">OAuth 2.0 인증</div>
      </div>
      <div class="card ${current === 'jira-server' ? 'selected' : ''}" role="button" tabindex="0" onclick="selectPlatform('jira-server')" onkeydown="if(event.key==='Enter') selectPlatform('jira-server')">
        <span class="card-icon">🖥️</span>
        <div class="card-title">Jira Server / DC</div>
        <div class="card-desc">API Token 인증</div>
      </div>
      <div class="card ${current === 'github' ? 'selected' : ''}" role="button" tabindex="0" onclick="selectPlatform('github')" onkeydown="if(event.key==='Enter') selectPlatform('github')">
        <span class="card-icon">🐙</span>
        <div class="card-title">GitHub</div>
        <div class="card-desc">Personal Access Token</div>
      </div>
      <div class="card disabled" role="button" tabindex="-1">
        <span class="card-icon">📐</span>
        <div class="card-title">Linear</div>
        <div class="card-desc">API Key</div>
      </div>
    </div>
  </div>

  <!-- Step 2: 로그인 폼 (Jira Server) -->
  <div id="form-jira-server" class="form-section ${showForm && current === 'jira-server' ? 'active' : ''}">
    <div class="form-group">
      <label>Jira 도메인</label>
      <input type="text" id="domain" placeholder="jira.example.com" />
      <div class="hint">프로토콜(https://) 제외, 도메인만 입력</div>
    </div>
    <div class="form-group">
      <label>이메일</label>
      <input type="email" id="email" placeholder="user@example.com" />
    </div>
    <div class="form-group">
      <label>API Token</label>
      <input type="password" id="apiToken" placeholder="API 토큰을 입력하세요" />
      <div class="hint">Jira → 프로필 → 보안 → API 토큰 생성</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" onclick="goBack()">← 뒤로</button>
      <button class="btn-primary" onclick="submitServer()">연결</button>
    </div>
  </div>

  <!-- Step 2: 로그인 폼 (Jira Cloud — OAuth) -->
  <div id="form-jira-cloud" class="form-section ${showForm && current === 'jira-cloud' ? 'active' : ''}">
    <div style="text-align:center; padding: 20px 0;">
      <span style="font-size:48px;">🔐</span>
      <p style="margin: 16px 0 8px; font-size: 14px; font-weight: 600;">Atlassian 계정으로 로그인</p>
      <p style="color: var(--muted); font-size: 12px; margin-bottom: 20px;">브라우저가 열리며 Atlassian OAuth 인증을 진행합니다.</p>
    </div>
    <div class="actions">
      <button class="btn-secondary" onclick="goBack()">← 뒤로</button>
      <button class="btn-primary" onclick="oauthLogin()">🔑 Atlassian으로 로그인</button>
    </div>
  </div>

  <!-- Step 2: 로그인 폼 (GitHub — PAT) -->
  <div id="form-github" class="form-section ${showForm && current === 'github' ? 'active' : ''}">
    <div class="form-group">
      <label>GitHub 도메인</label>
      <input type="text" id="gh-domain" placeholder="github.com" value="github.com" />
      <div class="hint">Enterprise는 github.your-company.com 형태</div>
    </div>
    <div class="form-group">
      <label>Personal Access Token</label>
      <input type="password" id="gh-token" placeholder="ghp_xxxxxxxxxxxxxxxx" />
      <div class="hint">Settings → Developer settings → Personal access tokens</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" onclick="goBack()">← 뒤로</button>
      <button class="btn-primary" onclick="submitGitHub()">연결</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  function selectPlatform(platform) {
    vscode.postMessage({ command: 'selectPlatform', platform });
  }

  function goBack() {
    vscode.postMessage({ command: 'back' });
  }

  function submitServer() {
    const domain = document.getElementById('domain').value.trim();
    const email = document.getElementById('email').value.trim();
    const apiToken = document.getElementById('apiToken').value.trim();
    if (!domain || !email || !apiToken) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    vscode.postMessage({ command: 'submitCredentials', domain, email, apiToken });
  }

  function submitGitHub() {
    const domain = document.getElementById('gh-domain').value.trim();
    const apiToken = document.getElementById('gh-token').value.trim();
    if (!domain || !apiToken) {
      alert('모든 필드를 입력해주세요.');
      return;
    }
    vscode.postMessage({ command: 'submitCredentials', domain, apiToken, email: '' });
  }

  function oauthLogin() {
    vscode.postMessage({ command: 'oauthLogin' });
  }
</script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
