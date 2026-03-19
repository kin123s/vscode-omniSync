import * as vscode from 'vscode';
import { MemoryManager } from './memory';
import { getTrackerConfig } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';

/**
 * Chat Participant module (Layer 3 — Bonus).
 *
 * Integrates with `@jira` mention in Copilot Chat to
 * query Jira issue data and produce context-aware responses.
 *
 * This module only works in environments where Copilot is available.
 * Without Copilot, L1+L2 tracking operates normally.
 */

const PARTICIPANT_ID = 'orx.assistant';

/**
 * Registers the Chat Participant.
 * @returns Disposable (for deregistration on deactivate)
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

        // 1) Record the conversation and generate response
        const assistantResponse = await handleChatRequest(
            userMessage,
            context,
            stream,
            token
        );

        // 2) If a tracking session is active, save to memory
        if (memory.getSession()) {
            await memory.addChatEntry({
                participant: '@jira',
                userMessage,
                assistantResponse,
                timestamp: new Date().toISOString(),
            });
        }
    };

    // Create and register Chat Participant
    const participant = vscode.chat.createChatParticipant(
        PARTICIPANT_ID,
        handler
    );
    participant.iconPath = new vscode.ThemeIcon('bookmark');

    return participant;
}

/**
 * Actual chat request handling logic.
 * Analyzes user intent and produces context-appropriate responses.
 */
async function handleChatRequest(
    prompt: string,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<string> {
    const responseParts: string[] = [];

    // Check for issue key pattern in the prompt
    const issueKeyMatch = prompt.match(/([A-Z][A-Z0-9_]+-\d+)/i);

    if (issueKeyMatch) {
        const issueKey = issueKeyMatch[1].toUpperCase();
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);

            stream.progress(`Fetching issue ${issueKey}...`);

            if (token.isCancellationRequested) {
                return '';
            }

            const issue = await adapter.fetchJiraIssue(issueKey);

            const response = [
                `## ${issue.key}: ${issue.summary}`,
                '',
                `**Status**: ${issue.status} | **Type**: ${issue.issueType} | **Priority**: ${issue.priority}`,
                '',
                issue.description ? `### Description\n${issue.description}` : '',
                '',
                issue.comments.length > 0
                    ? `### Recent Comments\n${issue.comments
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
            const errMsg = `Jira issue fetch failed: ${err.message}`;
            stream.markdown(errMsg);
            responseParts.push(errMsg);
        }
    } else {
        // General help message
        const helpMsg = [
            'Hello! I\'m the **@jira** assistant.',
            '',
            'Usage:',
            '- `@jira PROJ-123` — Fetch Jira issue details',
            '- `@jira PROJ-123 <your question>` — Ask about an issue with full context',
            '',
            '> 💡 If tracking mode is active, all conversations are automatically recorded.',
        ].join('\n');

        stream.markdown(helpMsg);
        responseParts.push(helpMsg);
    }

    return responseParts.join('\n');
}
