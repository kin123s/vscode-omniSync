import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from './webviewProtocol';

/**
 * Orx 由ы룷??由щ럭??Webview ?⑤꼸.
 *
 * React SPA(dist/webview/)瑜?濡쒕뱶?섏뿬 ?몄닔?멸퀎??由ы룷?몃? ?명꽣?숉떚釉뚰븯寃? * ?뚮뜑留겶룹닔?빧룸씪?고똿?????덈뒗 ?꾩슜 ?⑤꼸.
 *
 * ?깃????⑦꽩 ???숈떆???섎굹??由ы룷???⑤꼸留?議댁옱.
 */
export class ReportPanel {
  private static _instance: ReportPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  /** ?꾩옱 ?쒖떆 以묒씤 由ы룷??留덊겕?ㅼ슫 (?먮뵒?곗뿉???섏젙 ???낅뜲?댄듃) */
  private _currentMarkdown: string = '';

  /** ?몃? ?몃뱾?????≪뀡 硫붿떆吏瑜?泥섎━??肄쒕갚 */
  private _onAction?: (msg: WebviewToExtMessage) => Promise<void>;

  private constructor(
    extensionUri: vscode.Uri,
    onAction?: (msg: WebviewToExtMessage) => Promise<void>,
  ) {
    this._extensionUri = extensionUri;
    this._onAction = onAction;

    this._panel = vscode.window.createWebviewPanel(
      'orx.reportReview',
      'Orx ??Report',
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

    // Webview ??Extension 硫붿떆吏 ?섏떊
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this._handleWebviewMessage(msg),
      null,
      this._disposables,
    );

    // ?⑤꼸 ?ロ옒 泥섎━
    this._panel.onDidDispose(
      () => {
        ReportPanel._instance = undefined;
        this._disposables.forEach((d) => d.dispose());
      },
      null,
      this._disposables,
    );

    // React SPA HTML 濡쒕뱶
    this._panel.webview.html = this._getWebviewContent();
  }

  // ??? ?쇰툝由?API ???

  /**
   * ?⑤꼸???닿퀬 由ы룷???곗씠?곕? ?꾨떖?쒕떎.
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
   * Extension Host ??Webview濡?由ы룷???곗씠?곕? ?꾩넚?쒕떎.
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
   * ?곹깭 ?낅뜲?댄듃瑜?Webview???꾩넚?쒕떎.
   */
  sendStatus(status: 'loading' | 'ready' | 'error', message?: string): void {
    this._postMessageToWebview({
      type: 'updateStatus',
      payload: { status, message },
    });
  }

  /**
   * ?꾩옱 由ы룷??留덊겕?ㅼ슫??諛섑솚 (?먮뵒?곗뿉???섏젙??理쒖떊 踰꾩쟾).
   */
  getCurrentMarkdown(): string {
    return this._currentMarkdown;
  }

  static close(): void {
    ReportPanel._instance?._panel.dispose();
    ReportPanel._instance = undefined;
  }

  // ??? ?대? 硫붿꽌?????

  private _postMessageToWebview(message: ExtToWebviewMessage): void {
    this._panel.webview.postMessage(message);
  }

  /**
   * Webview?먯꽌 ?섏떊???≪뀡 硫붿떆吏瑜?泥섎━?쒕떎.
   */
  private async _handleWebviewMessage(msg: WebviewToExtMessage): Promise<void> {
    // ?먮뵒?곗뿉???섏젙??由ы룷???낅뜲?댄듃
    if (msg.type === 'action:editReport') {
      this._currentMarkdown = msg.payload.markdown;
    }

    // ?깅줉???몃? ?몃뱾?ъ뿉 ?꾩엫
    if (this._onAction) {
      await this._onAction(msg);
    }
  }

  /**
   * React SPA 踰덈뱾??濡쒕뱶?섎뒗 HTML???앹꽦?쒕떎.
   */
  private _getWebviewContent(): string {
    const webviewDistPath = path.join(
      this._extensionUri.fsPath,
      'dist',
      'webview',
    );

    // Vite 鍮뚮뱶 寃곌낵臾쇱씤 index.html???쎌뼱?⑤떎
    const indexHtmlPath = path.join(webviewDistPath, 'index.html');

    // index.html??議댁옱?섎㈃ 洹??덉쓽 寃쎈줈瑜?Webview URI濡?蹂??    if (fs.existsSync(indexHtmlPath)) {
      let html = fs.readFileSync(indexHtmlPath, 'utf-8');

      // ?뺤쟻 ?먯썝 寃쎈줈瑜?Webview URI濡?蹂??      const webviewUri = this._panel.webview.asWebviewUri(
        vscode.Uri.file(webviewDistPath),
      );

      // ?곷? 寃쎈줈(./)瑜?Webview URI濡?移섑솚
      html = html.replace(/(href|src)="\.\/([^"]+)"/g, `$1="${webviewUri}/$2"`);

      // CSP 硫뷀? ?쒓렇 二쇱엯 (湲곗〈 寃껋씠 ?놁쑝硫?異붽?)
      const nonce = getNonce();
      if (!html.includes('Content-Security-Policy')) {
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource};">`;
        html = html.replace('<head>', `<head>\n    ${cspMeta}`);
      }

      // script ?쒓렇??nonce 異붽?
      html = html.replace(/<script /g, `<script nonce="${nonce}" `);

      return html;
    }

    // 鍮뚮뱶 ?????곹깭 (媛쒕컻 珥덇린) ???덈궡 硫붿떆吏
    return `<!DOCTYPE html>
<html lang="ko">
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
    <h2>?숋툘 Webview UI 鍮뚮뱶媛 ?꾩슂?⑸땲??/h2>
    <p>?ㅼ쓬 紐낅졊?대? ?ㅽ뻾?섏꽭??</p>
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
