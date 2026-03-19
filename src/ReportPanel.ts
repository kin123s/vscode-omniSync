import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from './webviewProtocol';

/**
 * Orx Report Review Webview Panel.
 *
 * Loads the React SPA (dist/webview/) and displays interactive
 * report editing/export UI.
 *
 * Singleton: only one report panel exists at a time.
 */
export class ReportPanel {
  private static _instance: ReportPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  /** Currently displayed report markdown (updated by edits in the UI) */
  private _currentMarkdown: string = '';

  /** Callback to handle action messages from the Webview */
  private _onAction?: (msg: WebviewToExtMessage) => Promise<void>;

  private constructor(
    extensionUri: vscode.Uri,
    onAction?: (msg: WebviewToExtMessage) => Promise<void>,
  ) {
    this._extensionUri = extensionUri;
    this._onAction = onAction;

    this._panel = vscode.window.createWebviewPanel(
      'orx.reportReview',
      'Orx — Report',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist', 'webview'),
        ],
      },
    );

    this._panel.iconPath = new vscode.ThemeIcon('file-text');

    // Webview → Extension Host messaging
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this._handleWebviewMessage(msg),
      null,
      this._disposables,
    );

    // Panel close handler
    this._panel.onDidDispose(
      () => {
        ReportPanel._instance = undefined;
        this._disposables.forEach((d) => d.dispose());
      },
      null,
      this._disposables,
    );

    // Load React SPA HTML
    this._panel.webview.html = this._getWebviewContent();
  }

  // ── Public API ──

  /**
   * Opens the panel and delivers report data.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    onAction?: (msg: WebviewToExtMessage) => Promise<void>,
  ): ReportPanel {
    if (ReportPanel._instance) {
      ReportPanel._instance._panel.reveal(vscode.ViewColumn.One);
      ReportPanel._instance._onAction = onAction;
      return ReportPanel._instance;
    }
    ReportPanel._instance = new ReportPanel(extensionUri, onAction);
    return ReportPanel._instance;
  }

  /**
   * Sends report data from Extension Host to Webview.
   */
  sendReport(data: {
    markdown: string;
    issueKey: string;
    metadata: {
      platform: string;
      generatedAt: string;
      provider?: string;
      model?: string;
    };
  }): void {
    this._currentMarkdown = data.markdown;

    this._postMessageToWebview({
      type: 'reportData',
      payload: data,
    });
  }

  /**
   * Sends a status update to the Webview.
   */
  sendStatus(status: 'loading' | 'ready' | 'error', message?: string): void {
    this._postMessageToWebview({
      type: 'updateStatus',
      payload: { status, message },
    });
  }

  /**
   * Returns the current report markdown (may be edited in Webview).
   */
  getCurrentMarkdown(): string {
    return this._currentMarkdown;
  }

  static close(): void {
    ReportPanel._instance?._panel.dispose();
    ReportPanel._instance = undefined;
  }

  // ── Internal Methods ──

  private _postMessageToWebview(message: ExtToWebviewMessage): void {
    this._panel.webview.postMessage(message);
  }

  /**
   * Handles action messages received from the Webview.
   */
  private async _handleWebviewMessage(msg: WebviewToExtMessage): Promise<void> {
    // Update cached markdown on edits from the Webview
    if (msg.type === 'action:editReport') {
      this._currentMarkdown = msg.payload.markdown;
    }

    // Delegate to the registered action handler
    if (this._onAction) {
      await this._onAction(msg);
    }
  }

  /**
   * Generates the HTML that loads the React SPA bundle.
   */
  private _getWebviewContent(): string {
    const webviewDistPath = path.join(
      this._extensionUri.fsPath,
      'dist',
      'webview',
    );

    // Read the Vite build output index.html
    const indexHtmlPath = path.join(webviewDistPath, 'index.html');

    if (fs.existsSync(indexHtmlPath)) {
      let html = fs.readFileSync(indexHtmlPath, 'utf-8');

      // Convert static asset paths to Webview URIs
      const webviewUri = this._panel.webview.asWebviewUri(
        vscode.Uri.file(webviewDistPath),
      );

      // Replace relative paths (./) with Webview URIs
      html = html.replace(/(href|src)="\.\/([^"]+)"/g, `$1="${webviewUri}/$2"`);

      // Inject CSP meta tag if not present
      const nonce = getNonce();
      if (!html.includes('Content-Security-Policy')) {
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource};">`;
        html = html.replace('<head>', `<head>\n    ${cspMeta}`);
      }

      // Add nonce to script tags
      html = html.replace(/<script /g, `<script nonce="${nonce}" `);

      return html;
    }

    // Fallback: Webview UI not built yet (development initial state)
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orx Report</title>
  <style>
    body {
      font-family: var(--vscode-font-family, sans-serif);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      text-align: center;
    }
    .message { max-width: 400px; }
    code { background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="message">
    <h2>Webview UI build required</h2>
    <p>Run the following command:</p>
    <p><code>cd webview-ui && pnpm install && pnpm run build</code></p>
  </div>
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
