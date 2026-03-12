import * as vscode from 'vscode';
import { MemoryManager } from './memory';
import { getTrackerConfig } from './config';
import { JiraTrackerAdapter } from './adapters/JiraTrackerAdapter';

/**
 * Chat Participant 모듈 (Layer 3 — 보너스).
 *
 * `@jira` 멘션 시 Copilot Chat에서 직접 대화를 캡처하고,
 * Jira 이슈 데이터에 기반한 응답을 제공한다.
 *
 * 이 모듈은 Copilot이 설치된 환경에서만 동작하며,
 * 없어도 L1+L2 추적은 정상 작동한다.
 */

const PARTICIPANT_ID = 'universal-agent.assistant';

/**
 * Chat Participant를 등록한다.
 * @returns Disposable (해제 시 참가자 등록 해제)
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

        // 1) 대화를 메모리에 기록
        const assistantResponse = await handleChatRequest(
            userMessage,
            context,
            stream,
            token
        );

        // 2) 추적 세션이 활성 상태이면 메모리에 저장
        if (memory.getSession()) {
            await memory.addChatEntry({
                participant: '@jira',
                userMessage,
                assistantResponse,
                timestamp: new Date().toISOString(),
            });
        }
    };

    // Chat Participant 생성 및 등록
    const participant = vscode.chat.createChatParticipant(
        PARTICIPANT_ID,
        handler
    );
    participant.iconPath = new vscode.ThemeIcon('bookmark');

    return participant;
}

/**
 * 실제 채팅 요청 처리 로직.
 * 사용자의 질의 의도를 파악하여 적절히 응답한다.
 */
async function handleChatRequest(
    prompt: string,
    _context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<string> {
    const responseParts: string[] = [];

    // /fetch 슬래시 커맨드: 이슈 정보 조회
    const issueKeyMatch = prompt.match(/([A-Z][A-Z0-9_]+-\d+)/i);

    if (issueKeyMatch) {
        const issueKey = issueKeyMatch[1].toUpperCase();
        try {
            const config = getTrackerConfig();
            const adapter = new JiraTrackerAdapter(config);

            stream.progress(`${issueKey} 이슈를 조회하고 있습니다...`);

            if (token.isCancellationRequested) {
                return '';
            }

            const issue = await adapter.fetchJiraIssue(issueKey);

            const response = [
                `## ${issue.key}: ${issue.summary}`,
                '',
                `**상태**: ${issue.status} | **유형**: ${issue.issueType} | **우선순위**: ${issue.priority}`,
                '',
                issue.description ? `### 설명\n${issue.description}` : '',
                '',
                issue.comments.length > 0
                    ? `### 최근 코멘트\n${issue.comments
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
            const errMsg = `Jira 이슈 조회 실패: ${err.message}`;
            stream.markdown(errMsg);
            responseParts.push(errMsg);
        }
    } else {
        // 일반 대화: 안내 메시지
        const helpMsg = [
            '안녕하세요! **@jira** 에이전트입니다.',
            '',
            '사용 방법:',
            '- `@jira PROJ-123` — Jira 이슈 정보 조회',
            '- `@jira PROJ-123 이 이슈에 대해 알려줘` — 이슈 컨텍스트 기반 대화',
            '',
            '> 💡 추적 모드가 활성화되어 있으면, 이 대화 내용도 자동으로 기록됩니다.',
        ].join('\n');

        stream.markdown(helpMsg);
        responseParts.push(helpMsg);
    }

    return responseParts.join('\n');
}
