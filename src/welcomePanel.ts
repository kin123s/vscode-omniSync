import * as vscode from 'vscode';
import { getPlatform, TrackerPlatform } from './config';

/**
 * Welcome / Login Webview Panel.
 *
 * - Step 1: Platform selection (clickable cards)
 * - Step 2: Login form for the selected platform
 * - Singleton: only one panel exists at any time
 */
export class WelcomePanel {
    private static _instance: WelcomePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        _context: vscode.ExtensionContext,
        private _onConnect: () => void,
    ) {
        this._panel = vscode.window.createWebviewPanel(
            'orx.welcome',
            'Orx — Connect',
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

    /** Open panel (if already open, reveal + refresh) */
    static createOrShow(context: vscode.ExtensionContext, onConnect: () => void): void {
        if (WelcomePanel._instance) {
            WelcomePanel._instance._onConnect = onConnect;
            WelcomePanel._instance._panel.reveal(vscode.ViewColumn.One);
            WelcomePanel._instance._render(); // Refresh to latest state
            return;
        }
        WelcomePanel._instance = new WelcomePanel(context, onConnect);
    }

    /** Close panel from external code */
    static close(): void {
        WelcomePanel._instance?._panel.dispose();
        WelcomePanel._instance = undefined;
    }

    // ── Message Handler ──

    private async _handleMessage(msg: Record<string, string>): Promise<void> {
        switch (msg.command) {
            case 'selectPlatform': {
                const platform = msg.platform as TrackerPlatform;
                await vscode.workspace.getConfiguration('orx').update(
                    'trackerPlatform', platform, vscode.ConfigurationTarget.Global,
                );
                // After selection, transition to login form
                this._render(platform);
                break;
            }

            case 'submitCredentials': {
                const config = vscode.workspace.getConfiguration('orx');
                if (msg.domain) {
                    await config.update('trackerDomain', msg.domain, vscode.ConfigurationTarget.Global);
                }
                if (msg.email) {
                    await config.update('email', msg.email, vscode.ConfigurationTarget.Global);
                }
                if (msg.apiToken) {
                    await config.update('apiToken', msg.apiToken, vscode.ConfigurationTarget.Global);
                }

                vscode.window.showInformationMessage('✅ Connection settings saved. Verifying connection...');
                this._onConnect();
                WelcomePanel.close();
                break;
            }

            case 'oauthLogin': {
                await vscode.commands.executeCommand('orx.doOauthLogin');
                break;
            }

            case 'back': {
                this._render(); // Return to platform selection
                break;
            }
        }
    }

    // ── Render ──

    private _render(selectedPlatform?: TrackerPlatform): void {
        const nonce = getNonce();
        const current = selectedPlatform ?? getPlatform();
        const showForm = !!selectedPlatform;

        this._panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>Orx — Connect</title>
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
  }
  .card.disabled .card-title::after {
    content: ' (Coming Soon)';
    font-weight: 400;
    color: var(--muted);
  }

  /* Login form */
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
    <h1>Orx</h1>
    <p>${showForm ? 'Enter your connection details.' : 'Select your tracker platform.'}</p>
  </div>

  <!-- Step 1: Platform Selection -->
  <div id="platform-select" class="form-section ${!showForm ? 'active' : ''}">
    <div class="cards">
      <div class="card ${current === 'jira-cloud' ? 'selected' : ''}" role="button" tabindex="0" data-platform="jira-cloud">
        <span class="card-icon">🔵</span>
        <div class="card-title">Jira Cloud</div>
        <div class="card-desc">OAuth 2.0 Authentication</div>
      </div>
      <div class="card ${current === 'jira-server' ? 'selected' : ''}" role="button" tabindex="0" data-platform="jira-server">
        <span class="card-icon">🏢</span>
        <div class="card-title">Jira Server / DC</div>
        <div class="card-desc">API Token Authentication</div>
      </div>
      <div class="card ${current === 'github' ? 'selected' : ''}" role="button" tabindex="0" data-platform="github">
        <span class="card-icon">🐙</span>
        <div class="card-title">GitHub</div>
        <div class="card-desc">Personal Access Token</div>
      </div>
      <div class="card disabled" role="button" tabindex="-1">
        <span class="card-icon">🔷</span>
        <div class="card-title">Linear</div>
        <div class="card-desc">API Key</div>
      </div>
    </div>
  </div>

  <!-- Step 2: Login Form (Jira Server) -->
  <div id="form-jira-server" class="form-section ${showForm && current === 'jira-server' ? 'active' : ''}">
    <div class="form-group">
      <label>Jira Domain</label>
      <input type="text" id="domain" placeholder="jira.example.com" />
      <div class="hint">Domain only — no protocol (https://)</div>
    </div>
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="email" placeholder="user@example.com" />
    </div>
    <div class="form-group">
      <label>API Token</label>
      <input type="password" id="apiToken" placeholder="Enter your API token" />
      <div class="hint">Create an API token in Jira → Profile → Security</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" id="back-jira-server">← Back</button>
      <button class="btn-primary" id="submit-jira-server">Connect</button>
    </div>
  </div>

  <!-- Step 2: Login Form (Jira Cloud — OAuth) -->
  <div id="form-jira-cloud" class="form-section ${showForm && current === 'jira-cloud' ? 'active' : ''}">
    <div style="text-align:center; padding: 20px 0;">
      <span style="font-size:48px;">🔐</span>
      <p style="margin: 16px 0 8px; font-size: 14px; font-weight: 600;">Sign in with Atlassian</p>
      <p style="color: var(--muted); font-size: 12px; margin-bottom: 20px;">A browser window will open for Atlassian OAuth authentication.</p>
    </div>
    <div class="actions">
      <button class="btn-secondary" id="back-jira-cloud">← Back</button>
      <button class="btn-primary" id="submit-jira-cloud">🔗 Sign in with Atlassian</button>
    </div>
  </div>

  <!-- Step 2: Login Form (GitHub — PAT) -->
  <div id="form-github" class="form-section ${showForm && current === 'github' ? 'active' : ''}">
    <div class="form-group">
      <label>GitHub Domain</label>
      <input type="text" id="gh-domain" placeholder="github.com" value="github.com" />
      <div class="hint">For Enterprise: github.your-company.com</div>
    </div>
    <div class="form-group">
      <label>Personal Access Token</label>
      <input type="password" id="gh-token" placeholder="ghp_xxxxxxxxxxxxxxxx" />
      <div class="hint">Settings → Developer settings → Personal access tokens</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" id="back-github">← Back</button>
      <button class="btn-primary" id="submit-github">Connect</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  // ── Platform card click (data-platform attribute) ──
  document.querySelectorAll('.card[data-platform]').forEach(function(card) {
    card.addEventListener('click', function() {
      var platform = card.getAttribute('data-platform');
      if (platform) {
        vscode.postMessage({ command: 'selectPlatform', platform: platform });
      }
    });
    card.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { card.click(); }
    });
  });

  // ── Back buttons ──
  ['back-jira-server', 'back-jira-cloud', 'back-github'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', function() {
        vscode.postMessage({ command: 'back' });
      });
    }
  });

  // ── Jira Server connect ──
  var submitJiraServer = document.getElementById('submit-jira-server');
  if (submitJiraServer) {
    submitJiraServer.addEventListener('click', function() {
      var domain = document.getElementById('domain').value.trim();
      var email = document.getElementById('email').value.trim();
      var apiToken = document.getElementById('apiToken').value.trim();
      if (!domain || !email || !apiToken) {
        alert('Please fill in all fields.');
        return;
      }
      vscode.postMessage({ command: 'submitCredentials', domain: domain, email: email, apiToken: apiToken });
    });
  }

  // ── Jira Cloud OAuth login ──
  var submitJiraCloud = document.getElementById('submit-jira-cloud');
  if (submitJiraCloud) {
    submitJiraCloud.addEventListener('click', function() {
      vscode.postMessage({ command: 'oauthLogin' });
    });
  }

  // ── GitHub connect ──
  var submitGitHub = document.getElementById('submit-github');
  if (submitGitHub) {
    submitGitHub.addEventListener('click', function() {
      var domain = document.getElementById('gh-domain').value.trim();
      var apiToken = document.getElementById('gh-token').value.trim();
      if (!domain || !apiToken) {
        alert('Please fill in all fields.');
        return;
      }
      vscode.postMessage({ command: 'submitCredentials', domain: domain, apiToken: apiToken, email: '' });
    });
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
