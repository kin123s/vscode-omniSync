import * as vscode from 'vscode';
import { getPlatform, TrackerPlatform } from './config';

/**
 * Welcome / 濡쒓렇??Webview ?⑤꼸.
 *
 * - Step 1: ?뚮옯???좏깮 (?쒓컖??移대뱶)
 * - Step 2: ?좏깮???뚮옯?쇱뿉 留욌뒗 濡쒓렇????
 * - ?깃????⑦꽩 ???숈떆???섎굹???⑤꼸留?議댁옱
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
            'Orx ??Connect',
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

    /** ?⑤꼸 ?닿린 (?대? ?대젮 ?덉쑝硫??ъ빱??+ ?щ젋?붾쭅) */
    static createOrShow(context: vscode.ExtensionContext, onConnect: () => void): void {
        if (WelcomePanel._instance) {
            WelcomePanel._instance._onConnect = onConnect;
            WelcomePanel._instance._panel.reveal(vscode.ViewColumn.One);
            WelcomePanel._instance._render(); // ??긽 理쒖떊 ?곹깭濡??щ젋?붾쭅
            return;
        }
        WelcomePanel._instance = new WelcomePanel(context, onConnect);
    }

    /** ?몃??먯꽌 ?⑤꼸 ?リ린 */
    static close(): void {
        WelcomePanel._instance?._panel.dispose();
        WelcomePanel._instance = undefined;
    }

    // ?? 硫붿떆吏 ?몃뱾????

    private async _handleMessage(msg: Record<string, string>): Promise<void> {
        switch (msg.command) {
            case 'selectPlatform': {
                const platform = msg.platform as TrackerPlatform;
                await vscode.workspace.getConfiguration('orx').update(
                    'trackerPlatform', platform, vscode.ConfigurationTarget.Global,
                );
                // ?좏깮 ??濡쒓렇???쇱쑝濡??꾪솚
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

                vscode.window.showInformationMessage('???곌껐 ?뺣낫媛 ??λ릺?덉뒿?덈떎. ?곌껐???뺤씤?⑸땲??..');
                this._onConnect();
                WelcomePanel.close();
                break;
            }

            case 'oauthLogin': {
                await vscode.commands.executeCommand('orx.doOauthLogin');
                break;
            }

            case 'back': {
                this._render(); // ?뚮옯???좏깮?쇰줈 ?뚯븘媛湲?
                break;
            }
        }
    }

    // ?? ?뚮뜑留???

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
<title>Orx ??Connect</title>
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
    /* pointer-events: none; ?쒓굅?섏뿬 ??댄? ?대┃ ???덈궡 硫붿떆吏 ?깆쓣 ?먰븯硫??ㅼ젙, ?꾩옱???⑥닚 鍮꾪솢?깊솕 */
  }
  .card.disabled .card-title::after {
    content: ' (以鍮?以?';
    font-weight: 400;
    color: var(--muted);
  }

  /* 濡쒓렇????*/
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
    <p>${showForm ? '?곌껐 ?뺣낫瑜??낅젰?섏꽭?? : '?곌껐???뚮옯?쇱쓣 ?좏깮?섏꽭??}</p>
  </div>

  <!-- Step 1: ?뚮옯???좏깮 -->
  <div id="platform-select" class="form-section ${!showForm ? 'active' : ''}">
    <div class="cards">
      <div class="card ${current === 'jira-cloud' ? 'selected' : ''}" role="button" tabindex="0" data-platform="jira-cloud">
        <span class="card-icon">?뙋</span>
        <div class="card-title">Jira Cloud</div>
        <div class="card-desc">OAuth 2.0 ?몄쬆</div>
      </div>
      <div class="card ${current === 'jira-server' ? 'selected' : ''}" role="button" tabindex="0" data-platform="jira-server">
        <span class="card-icon">?뼢截?/span>
        <div class="card-title">Jira Server / DC</div>
        <div class="card-desc">API Token ?몄쬆</div>
      </div>
      <div class="card ${current === 'github' ? 'selected' : ''}" role="button" tabindex="0" data-platform="github">
        <span class="card-icon">?릻</span>
        <div class="card-title">GitHub</div>
        <div class="card-desc">Personal Access Token</div>
      </div>
      <div class="card disabled" role="button" tabindex="-1">
        <span class="card-icon">?뱪</span>
        <div class="card-title">Linear</div>
        <div class="card-desc">API Key</div>
      </div>
    </div>
  </div>

  <!-- Step 2: 濡쒓렇????(Jira Server) -->
  <div id="form-jira-server" class="form-section ${showForm && current === 'jira-server' ? 'active' : ''}">
    <div class="form-group">
      <label>Jira ?꾨찓??/label>
      <input type="text" id="domain" placeholder="jira.example.com" />
      <div class="hint">?꾨줈?좎퐳(https://) ?쒖쇅, ?꾨찓?몃쭔 ?낅젰</div>
    </div>
    <div class="form-group">
      <label>?대찓??/label>
      <input type="email" id="email" placeholder="user@example.com" />
    </div>
    <div class="form-group">
      <label>API Token</label>
      <input type="password" id="apiToken" placeholder="API ?좏겙???낅젰?섏꽭?? />
      <div class="hint">Jira ???꾨줈????蹂댁븞 ??API ?좏겙 ?앹꽦</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" id="back-jira-server">???ㅻ줈</button>
      <button class="btn-primary" id="submit-jira-server">?곌껐</button>
    </div>
  </div>

  <!-- Step 2: 濡쒓렇????(Jira Cloud ??OAuth) -->
  <div id="form-jira-cloud" class="form-section ${showForm && current === 'jira-cloud' ? 'active' : ''}">
    <div style="text-align:center; padding: 20px 0;">
      <span style="font-size:48px;">?뵍</span>
      <p style="margin: 16px 0 8px; font-size: 14px; font-weight: 600;">Atlassian 怨꾩젙?쇰줈 濡쒓렇??/p>
      <p style="color: var(--muted); font-size: 12px; margin-bottom: 20px;">釉뚮씪?곗?媛 ?대━硫?Atlassian OAuth ?몄쬆??吏꾪뻾?⑸땲??</p>
    </div>
    <div class="actions">
      <button class="btn-secondary" id="back-jira-cloud">???ㅻ줈</button>
      <button class="btn-primary" id="submit-jira-cloud">?뵎 Atlassian?쇰줈 濡쒓렇??/button>
    </div>
  </div>

  <!-- Step 2: 濡쒓렇????(GitHub ??PAT) -->
  <div id="form-github" class="form-section ${showForm && current === 'github' ? 'active' : ''}">
    <div class="form-group">
      <label>GitHub ?꾨찓??/label>
      <input type="text" id="gh-domain" placeholder="github.com" value="github.com" />
      <div class="hint">Enterprise??github.your-company.com ?뺥깭</div>
    </div>
    <div class="form-group">
      <label>Personal Access Token</label>
      <input type="password" id="gh-token" placeholder="ghp_xxxxxxxxxxxxxxxx" />
      <div class="hint">Settings ??Developer settings ??Personal access tokens</div>
    </div>
    <div class="actions">
      <button class="btn-secondary" id="back-github">???ㅻ줈</button>
      <button class="btn-primary" id="submit-github">?곌껐</button>
    </div>
  </div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  // ?? ?뚮옯??移대뱶 ?대┃ (data-platform ?띿꽦 湲곕컲) ??
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

  // ?? ?ㅻ줈 踰꾪듉 ??
  ['back-jira-server', 'back-jira-cloud', 'back-github'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', function() {
        vscode.postMessage({ command: 'back' });
      });
    }
  });

  // ?? Jira Server ?곌껐 ??
  var submitJiraServer = document.getElementById('submit-jira-server');
  if (submitJiraServer) {
    submitJiraServer.addEventListener('click', function() {
      var domain = document.getElementById('domain').value.trim();
      var email = document.getElementById('email').value.trim();
      var apiToken = document.getElementById('apiToken').value.trim();
      if (!domain || !email || !apiToken) {
        alert('紐⑤뱺 ?꾨뱶瑜??낅젰?댁＜?몄슂.');
        return;
      }
      vscode.postMessage({ command: 'submitCredentials', domain: domain, email: email, apiToken: apiToken });
    });
  }

  // ?? Jira Cloud OAuth 濡쒓렇????
  var submitJiraCloud = document.getElementById('submit-jira-cloud');
  if (submitJiraCloud) {
    submitJiraCloud.addEventListener('click', function() {
      vscode.postMessage({ command: 'oauthLogin' });
    });
  }

  // ?? GitHub ?곌껐 ??
  var submitGitHub = document.getElementById('submit-github');
  if (submitGitHub) {
    submitGitHub.addEventListener('click', function() {
      var domain = document.getElementById('gh-domain').value.trim();
      var apiToken = document.getElementById('gh-token').value.trim();
      if (!domain || !apiToken) {
        alert('紐⑤뱺 ?꾨뱶瑜??낅젰?댁＜?몄슂.');
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
