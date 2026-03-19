import * as vscode from 'vscode';
import { MemoryManager } from './memory';
import { getTrackerConfig } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';

/**
 * Chat Participant 紐⑤뱢 (Layer 3 ??蹂대꼫??.
 *
 * `@jira` 硫섏뀡 ??Copilot Chat?먯꽌 吏곸젒 ??붾? 罹≪쿂?섍퀬,
 * Jira ?댁뒋 ?곗씠?곗뿉 湲곕컲???묐떟???쒓났?쒕떎.
 *
 * ??紐⑤뱢? Copilot???ㅼ튂???섍꼍?먯꽌留??숈옉?섎ŉ,
 * ?놁뼱??L1+L2 異붿쟻? ?뺤긽 ?묐룞?쒕떎.
 */

const PARTICIPANT_ID = 'orx.assistant';

/**
 * Chat Participant瑜??깅줉?쒕떎.
 * @returns Disposable (?댁젣 ??李멸????깅줉 ?댁젣)
 */
export function registerChatParticipant(
    memory: MemoryManager
): vscode.Disposable {
    const handler: vscode.ChatRequestHandler = async (
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> => {
        const userMessage = request.prompt;

        // 1) ??붾? 硫붾え由ъ뿉 湲곕줉
        const assistantResponse = await handleChatRequest(
            userMessage,
            context,
            stream,
            token
        );

        // 2) 異붿쟻 ?몄뀡???쒖꽦 ?곹깭?대㈃ 硫붾え由ъ뿉 ???
        if (memory.getSession()) {
            await memory.addChatEntry({
                participant: '@jira',
                userMessage,
                assistantResponse,
                timestamp: new Date().toISOString(),
            });
        }
    };

    // Chat Participant ?앹꽦 諛??깅줉
    const participant = vscode.chat.createChatParticipant(
        PARTICIPANT_ID,
        handler
    );
    participant.iconPath = new vscode.ThemeIcon('bookmark');

    return participant;
}

/**
 * ?ㅼ젣 梨꾪똿 ?붿껌 泥섎━ 濡쒖쭅.
 * ?ъ슜?먯쓽 吏덉쓽 ?섎룄瑜??뚯븙?섏뿬 ?곸젅???묐떟?쒕떎.
 */
async function handleChatRequest(
    prompt: string,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<string> {
    const responseParts: string[] = [];

    // /fetch ?щ옒??而ㅻ㎤?? ?댁뒋 ?뺣낫 議고쉶
    const issueKeyMatch = prompt.match(/([A-Z][A-Z0-9_]+-\d+)/i);

    if (issueKeyMatch) {
        const issueKey = issueKeyMatch[1].toUpperCase();
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);

            stream.progress(`${issueKey} ?댁뒋瑜?議고쉶?섍퀬 ?덉뒿?덈떎...`);

            if (token.isCancellationRequested) {
                return '';
            }

            const issue = await adapter.fetchJiraIssue(issueKey);

            const response = [
                `## ${issue.key}: ${issue.summary}`,
                '',
                `**?곹깭**: ${issue.status} | **?좏삎**: ${issue.issueType} | **?곗꽑?쒖쐞**: ${issue.priority}`,
                '',
                issue.description ? `### ?ㅻ챸\n${issue.description}` : '',
                '',
                issue.comments.length > 0
                    ? `### 理쒓렐 肄붾찘??n${issue.comments
                        .slice(-3)
                        .map(c => `> **${c.author}**: ${c.body}`)
                        .join('\n\n')}`
                    : '',
            ]
                .filter(Boolean)
                .join('\n');

            stream.markdown(response);
            responseParts.push(response);
        } catch (err: any) {
            const errMsg = `Jira ?댁뒋 議고쉶 ?ㅽ뙣: ${err.message}`;
            stream.markdown(errMsg);
            responseParts.push(errMsg);
        }
    } else {
        // ?쇰컲 ??? ?덈궡 硫붿떆吏
        const helpMsg = [
            '?덈뀞?섏꽭?? **@jira** ?먯씠?꾪듃?낅땲??',
            '',
            '?ъ슜 諛⑸쾿:',
            '- `@jira PROJ-123` ??Jira ?댁뒋 ?뺣낫 議고쉶',
            '- `@jira PROJ-123 ???댁뒋??????뚮젮以? ???댁뒋 而⑦뀓?ㅽ듃 湲곕컲 ???,
            '',
            '> ?뮕 異붿쟻 紐⑤뱶媛 ?쒖꽦?붾릺???덉쑝硫? ??????댁슜???먮룞?쇰줈 湲곕줉?⑸땲??',
        ].join('\n');

        stream.markdown(helpMsg);
        responseParts.push(helpMsg);
    }

    return responseParts.join('\n');
}
