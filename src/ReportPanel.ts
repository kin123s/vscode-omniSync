import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from './webviewProtocol';

/**
 * OmniSync 리포트 리뷰용 Webview 패널.
 *
 * React SPA(dist/webview/)를 로드하여 인수인계서 리포트를 인터랙티브하게
 * 렌더링·수정·라우팅할 수 있는 전용 패널.
 *
 * 싱글톤 패턴 — 동시에 하나의 리포트 패널만 존재.
 */
export class ReportPanel {
  private static _instance: ReportPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  /** 현재 표시 중인 리포트 마크다운 (에디터에서 수정 시 업데이트) */
  private _currentMarkdown: string = '';
  private _currentIssueKey: string = '';

  /** 외부 핸들러 — 액션 메시지를 처리할 콜백 */
  private _onAction?: (msg: WebviewToExtMessage) => Promise<void>;

  private constructor(
    extensionUri: vscode.Uri,
    onAction?: (msg: WebviewToExtMessage) => Promise<void>,
  ) {
    this._extensionUri = extensionUri;
    this._onAction = onAction;

    this._panel = vscode.window.createWebviewPanel(
      'omnisync.reportReview',
      'OmniSync — Report',
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

    // Webview → Extension 메시지 수신
    this._panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this._handleWebviewMessage(msg),
      null,
      this._disposables,
    );

    // 패널 닫힘 처리
    this._panel.onDidDispose(
      () => {
        ReportPanel._instance = undefined;
        this._disposables.forEach((d) => d.dispose());
      },
      null,
      this._disposables,
    );

    // React SPA HTML 로드
    this._panel.webview.html = this._getWebviewContent();
  }

  // ─── 퍼블릭 API ───

  /**
   * 패널을 열고 리포트 데이터를 전달한다.
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
   * Extension Host → Webview로 리포트 데이터를 전송한다.
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
    this._currentIssueKey = data.issueKey;

    this._postMessageToWebview({
      type: 'reportData',
      payload: data,
    });
  }

  /**
   * 상태 업데이트를 Webview에 전송한다.
   */
  sendStatus(status: 'loading' | 'ready' | 'error', message?: string): void {
    this._postMessageToWebview({
      type: 'updateStatus',
      payload: { status, message },
    });
  }

  /**
   * 현재 리포트 마크다운을 반환 (에디터에서 수정된 최신 버전).
   */
  getCurrentMarkdown(): string {
    return this._currentMarkdown;
  }

  static close(): void {
    ReportPanel._instance?._panel.dispose();
    ReportPanel._instance = undefined;
  }

  // ─── 내부 메서드 ───

  private _postMessageToWebview(message: ExtToWebviewMessage): void {
    this._panel.webview.postMessage(message);
  }

  /**
   * Webview에서 수신한 액션 메시지를 처리한다.
   */
  private async _handleWebviewMessage(msg: WebviewToExtMessage): Promise<void> {
    // 에디터에서 수정된 리포트 업데이트
    if (msg.type === 'action:editReport') {
      this._currentMarkdown = msg.payload.markdown;
    }

    // 등록된 외부 핸들러에 위임
    if (this._onAction) {
      await this._onAction(msg);
    }
  }

  /**
   * React SPA 번들을 로드하는 HTML을 생성한다.
   */
  private _getWebviewContent(): string {
    const webviewDistPath = path.join(
      this._extensionUri.fsPath,
      'dist',
      'webview',
    );

    // Vite 빌드 결과물인 index.html을 읽어온다
    const indexHtmlPath = path.join(webviewDistPath, 'index.html');

    // index.html이 존재하면 그 안의 경로를 Webview URI로 변환
    if (fs.existsSync(indexHtmlPath)) {
      let html = fs.readFileSync(indexHtmlPath, 'utf-8');

      // 정적 자원 경로를 Webview URI로 변환
      const webviewUri = this._panel.webview.asWebviewUri(
        vscode.Uri.file(webviewDistPath),
      );

      // 상대 경로(./)를 Webview URI로 치환
      html = html.replace(/(href|src)="\.\/([^"]+)"/g, `$1="${webviewUri}/$2"`);

      // CSP 메타 태그 주입 (기존 것이 없으면 추가)
      const nonce = getNonce();
      if (!html.includes('Content-Security-Policy')) {
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${this._panel.webview.cspSource}; font-src ${this._panel.webview.cspSource};">`;
        html = html.replace('<head>', `<head>\n    ${cspMeta}`);
      }

      // script 태그에 nonce 추가
      html = html.replace(/<script /g, `<script nonce="${nonce}" `);

      return html;
    }

    // 빌드 안 된 상태 (개발 초기) — 안내 메시지
    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OmniSync Report</title>
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
    <h2>⚙️ Webview UI 빌드가 필요합니다</h2>
    <p>다음 명령어를 실행하세요:</p>
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
