import * as vscode from 'vscode';

/**
 * Planner Webview Panel.
 *
 * LLM???앹꽦???묒뾽 怨꾪쉷??Markdown)瑜?VS Code Webview Panel??
 * 源붾걫??HTML濡??뚮뜑留곹븳?? VS Code ?뚮쭏??留욌뒗 ?ㅽ??쇰쭅???곸슜?쒕떎.
 */
export class PlannerViewProvider {
    public static readonly viewType = 'orx.plannerView';

    private panel: vscode.WebviewPanel | undefined;

    constructor() {}

    /**
     * ?묒뾽 怨꾪쉷?쒕? Webview Panel???쒖떆?쒕떎.
     * ?대? ?대젮 ?덉쑝硫??댁슜??媛깆떊?섍퀬, ?놁쑝硫??덈줈 ?앹꽦?쒕떎.
     *
     * @param markdownContent - 怨꾪쉷??Markdown ?띿뒪??
     * @param issueKey - Jira ?댁뒋 ??(?⑤꼸 ??댄???
     */
    public show(markdownContent: string, issueKey: string): void {
        if (this.panel) {
            // 湲곗〈 ?⑤꼸 媛깆떊
            this.panel.title = `?뱥 Plan: ${issueKey}`;
            this.panel.webview.html = this.getHtml(markdownContent, issueKey);
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            // ???⑤꼸 ?앹꽦
            this.panel = vscode.window.createWebviewPanel(
                PlannerViewProvider.viewType,
                `?뱥 Plan: ${issueKey}`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: false,
                    localResourceRoots: [],
                }
            );

            this.panel.webview.html = this.getHtml(markdownContent, issueKey);

            // ?⑤꼸 ?ロ옒 ??李몄“ ?댁젣
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }
    }

    /**
     * Markdown??媛꾩씠 HTML濡?蹂?섑븯??Webview???쒖떆???꾩껜 HTML??諛섑솚?쒕떎.
     * ?몃? ?쇱씠釉뚮윭由??놁씠 湲곕낯 Markdown 臾몃쾿??泥섎━?쒕떎.
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

        /* 泥댄겕由ъ뒪???ㅽ???*/
        .checklist {
            list-style: none;
            padding-left: 8px;
        }
        .checklist li::before {
            content: '??';
            color: var(--vscode-textLink-foreground, #3794ff);
            font-size: 1.1em;
        }
        .checklist li.checked::before {
            content: '??';
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
     * 媛꾩씠 Markdown ??HTML 蹂?섍린.
     * ?몃? ?쇱씠釉뚮윭由??섏〈???놁씠 湲곕낯?곸씤 Markdown 臾몃쾿??吏?먰븳??
     */
    private markdownToHtml(md: string): string {
        let html = this.escapeHtml(md);

        // 肄붾뱶 釉붾줉 (```...```) ??癒쇱? 泥섎━?섏뿬 ?대? ?뚯떛 諛⑹?
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
            return `<pre><code>${code.trim()}</code></pre>`;
        });

        // ?몃씪??肄붾뱶 (`...`)
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // ?ㅻ뜑 (### ??h3, ## ??h2, # ??h1)
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Blockquote (> ...)
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
        // ?곗냽 blockquote 蹂묓빀
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

        // ?섑룊??(---)
        html = html.replace(/^---$/gm, '<hr>');

        // 泥댄겕由ъ뒪??(- [ ] / - [x])
        html = html.replace(/^- \[ \] (.+)$/gm, '<li class="checklist-item">$1</li>');
        html = html.replace(/^- \[x\] (.+)$/gm, '<li class="checklist-item checked">$1</li>');

        // ?쇰컲 由ъ뒪??(- ...)
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');

        // li瑜?ul濡?媛먯떥湲?
        html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, (match) => {
            const isChecklist = match.includes('checklist-item');
            const cls = isChecklist ? ' class="checklist"' : '';
            return `<ul${cls}>\n${match}</ul>\n`;
        });

        // 蹂쇰뱶 (**...**)
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // ?댄깶由?(*...*)
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // ?⑤씫 蹂??(鍮?以????⑤씫 遺꾨━)
        html = html
            .split('\n\n')
            .map(block => {
                const trimmed = block.trim();
                // ?대? 釉붾줉 ?붿냼??寃쎌슦 媛먯떥吏 ?딆쓬
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

    /** HTML ?댁뒪耳?댄봽 */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
