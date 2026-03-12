import * as vscode from 'vscode';

/**
 * Planner Webview Panel.
 *
 * LLM이 생성한 작업 계획서(Markdown)를 VS Code Webview Panel에
 * 깔끔한 HTML로 렌더링한다. VS Code 테마에 맞는 스타일링을 적용한다.
 */
export class PlannerViewProvider {
    public static readonly viewType = 'universalAgent.plannerView';

    private panel: vscode.WebviewPanel | undefined;

    constructor() {}

    /**
     * 작업 계획서를 Webview Panel에 표시한다.
     * 이미 열려 있으면 내용을 갱신하고, 없으면 새로 생성한다.
     *
     * @param markdownContent - 계획서 Markdown 텍스트
     * @param issueKey - Jira 이슈 키 (패널 타이틀용)
     */
    public show(markdownContent: string, issueKey: string): void {
        if (this.panel) {
            // 기존 패널 갱신
            this.panel.title = `📋 Plan: ${issueKey}`;
            this.panel.webview.html = this.getHtml(markdownContent, issueKey);
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            // 새 패널 생성
            this.panel = vscode.window.createWebviewPanel(
                PlannerViewProvider.viewType,
                `📋 Plan: ${issueKey}`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: false,
                    localResourceRoots: [],
                }
            );

            this.panel.webview.html = this.getHtml(markdownContent, issueKey);

            // 패널 닫힘 시 참조 해제
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }
    }

    /**
     * Markdown을 간이 HTML로 변환하여 Webview에 표시할 전체 HTML을 반환한다.
     * 외부 라이브러리 없이 기본 Markdown 문법을 처리한다.
     */
    private getHtml(markdown: string, issueKey: string): string {
        const nonce = this.getNonce();
        const htmlBody = this.markdownToHtml(markdown);

        return /*html*/ `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Plan: ${this.escapeHtml(issueKey)}</title>
    <style nonce="${nonce}">
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 14px);
            color: var(--vscode-foreground, #cccccc);
            background-color: var(--vscode-editor-background, #1e1e1e);
            line-height: 1.6;
            padding: 20px 30px;
            max-width: 900px;
            margin: 0 auto;
        }

        h1 { 
            font-size: 1.6em; 
            border-bottom: 2px solid var(--vscode-textSeparator-foreground, #444);
            padding-bottom: 8px;
            margin-top: 24px;
        }
        h2 { 
            font-size: 1.3em; 
            margin-top: 24px;
            color: var(--vscode-textLink-foreground, #3794ff);
        }
        h3 { 
            font-size: 1.1em; 
            margin-top: 16px; 
        }

        blockquote {
            border-left: 4px solid var(--vscode-textLink-foreground, #3794ff);
            margin: 12px 0;
            padding: 8px 16px;
            background: var(--vscode-textBlockQuote-background, #2a2a2a);
            border-radius: 0 4px 4px 0;
        }

        code {
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            background: var(--vscode-textCodeBlock-background, #2d2d2d);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.9em;
        }

        pre {
            background: var(--vscode-textCodeBlock-background, #2d2d2d);
            padding: 12px 16px;
            border-radius: 6px;
            overflow-x: auto;
            border: 1px solid var(--vscode-widget-border, #444);
        }
        pre code {
            background: none;
            padding: 0;
        }

        ul, ol {
            padding-left: 24px;
        }
        li {
            margin: 4px 0;
        }

        /* 체크리스트 스타일 */
        .checklist {
            list-style: none;
            padding-left: 8px;
        }
        .checklist li::before {
            content: '☐ ';
            color: var(--vscode-textLink-foreground, #3794ff);
            font-size: 1.1em;
        }
        .checklist li.checked::before {
            content: '☑ ';
            color: var(--vscode-testing-iconPassed, #73c991);
        }

        hr {
            border: none;
            border-top: 1px solid var(--vscode-textSeparator-foreground, #444);
            margin: 20px 0;
        }

        strong {
            color: var(--vscode-foreground, #ffffff);
        }

        table {
            border-collapse: collapse;
            width: 100%;
            margin: 12px 0;
        }
        th, td {
            border: 1px solid var(--vscode-widget-border, #444);
            padding: 8px 12px;
            text-align: left;
        }
        th {
            background: var(--vscode-textCodeBlock-background, #2d2d2d);
        }
    </style>
</head>
<body>
    ${htmlBody}
</body>
</html>`;
    }

    /**
     * 간이 Markdown → HTML 변환기.
     * 외부 라이브러리 의존성 없이 기본적인 Markdown 문법을 지원한다.
     */
    private markdownToHtml(md: string): string {
        let html = this.escapeHtml(md);

        // 코드 블록 (```...```) — 먼저 처리하여 내부 파싱 방지
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
            return `<pre><code>${code.trim()}</code></pre>`;
        });

        // 인라인 코드 (`...`)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 헤더 (### → h3, ## → h2, # → h1)
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Blockquote (> ...)
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        // 연속 blockquote 병합
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

        // 수평선 (---)
        html = html.replace(/^---$/gm, '<hr>');

        // 체크리스트 (- [ ] / - [x])
        html = html.replace(/^- \[ \] (.+)$/gm, '<li class="checklist-item">$1</li>');
        html = html.replace(/^- \[x\] (.+)$/gm, '<li class="checklist-item checked">$1</li>');

        // 일반 리스트 (- ...)
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

        // li를 ul로 감싸기
        html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, (match) => {
            const isChecklist = match.includes('checklist-item');
            const cls = isChecklist ? ' class="checklist"' : '';
            return `<ul${cls}>\n${match}</ul>\n`;
        });

        // 볼드 (**...**)
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // 이탤릭 (*...*)
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // 단락 변환 (빈 줄 → 단락 분리)
        html = html
            .split('\n\n')
            .map(block => {
                const trimmed = block.trim();
                // 이미 블록 요소인 경우 감싸지 않음
                if (
                    trimmed.startsWith('<h') ||
                    trimmed.startsWith('<ul') ||
                    trimmed.startsWith('<ol') ||
                    trimmed.startsWith('<pre') ||
                    trimmed.startsWith('<blockquote') ||
                    trimmed.startsWith('<hr') ||
                    trimmed.startsWith('<table') ||
                    trimmed === ''
                ) {
                    return trimmed;
                }
                return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
            })
            .join('\n\n');

        return html;
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /** HTML 이스케이프 */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
