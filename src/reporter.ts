import * as vscode from 'vscode';
import { TrackingSession } from './memory';
import { sendLlmRequest, LlmMessage } from './llmService';

/**
 * Reporter 모듈.
 *
 * Tracker가 수집한 작업 기록(터미널, 파일 변경, AI 대화)을
 * LLM에 전달하여 "어떤 문제를 어떻게 해결했는지" 요약 리포트를 생성한다.
 */

// ─── 시스템 프롬프트 ───

const REPORT_SYSTEM_PROMPT = `You are a senior software engineer writing a **Work Report** for a Jira issue.
You are given a tracking session that includes terminal commands, file changes, and AI conversations.

## Output Requirements
1. **Language**: Write entirely in Korean (한국어).
2. **Format**: Use Markdown with the following structure:
   - ## 📋 작업 요약 — 1-2줄 핵심 요약
   - ## 🔧 수행 내역 — 무엇을 했는지 상세 설명
   - ## 📂 변경된 파일 — 수정/생성/삭제된 파일 목록
   - ## 💻 실행 명령어 — 빌드, 테스트 등 실행된 명령어
   - ## ✅ 결과 — 작업 결과 및 확인 사항
3. **Concise**: Jira 코멘트에 적합하도록 간결하게 작성.
4. **No code blocks**: 코드 블록은 최소화하고 핵심만 기술.

## Rules
- Focus on WHAT was done and WHY, not HOW the code works.
- If terminal commands show test results, mention pass/fail status.
- Group related file changes together logically.`;

// ─── 세션 → 프롬프트 변환 ───

function buildReportPrompt(session: TrackingSession): string {
    const parts: string[] = [];

    parts.push(`# 작업 추적 데이터: ${session.issueKey}`);
    parts.push(`- 시작: ${session.startedAt}`);
    parts.push(`- 종료: ${session.endedAt ?? '진행 중'}`);
    parts.push('');

    // 터미널 명령어
    if (session.terminalEntries.length > 0) {
        parts.push(`## 실행된 터미널 명령어 (${session.terminalEntries.length}개)`);
        for (const entry of session.terminalEntries) {
            const exitInfo = entry.exitCode !== undefined
                ? ` → exit: ${entry.exitCode}`
                : '';
            parts.push(`- \`${entry.command}\`${exitInfo}`);
        }
        parts.push('');
    }

    // 파일 변경
    if (session.fileChanges.length > 0) {
        parts.push(`## 변경된 파일 (${session.fileChanges.length}개)`);
        for (const fc of session.fileChanges) {
            parts.push(`- [${fc.changeType}] ${fc.filePath}`);
            if (fc.diff) {
                // diff가 너무 길면 잘라서 전송
                const truncatedDiff = fc.diff.length > 500
                    ? fc.diff.substring(0, 500) + '\n... (truncated)'
                    : fc.diff;
                parts.push(`\`\`\`diff\n${truncatedDiff}\n\`\`\``);
            }
        }
        parts.push('');
    }

    // AI 대화
    if (session.chatEntries.length > 0) {
        parts.push(`## AI 대화 기록 (${session.chatEntries.length}개)`);
        for (const chat of session.chatEntries) {
            parts.push(`### ${chat.participant} (${chat.timestamp})`);
            parts.push(`**질문**: ${chat.userMessage}`);
            // 응답이 너무 길면 요약
            const response = chat.assistantResponse.length > 300
                ? chat.assistantResponse.substring(0, 300) + '...'
                : chat.assistantResponse;
            parts.push(`**응답**: ${response}`);
            parts.push('');
        }
    }

    parts.push('---');
    parts.push('위 작업 기록을 분석하여, Jira 코멘트에 적합한 간결한 작업 리포트를 생성해 주세요.');

    return parts.join('\n');
}

// ─── 리포트 생성 ───

/**
 * 추적 세션 데이터를 기반으로 LLM을 호출하여 작업 리포트를 생성한다.
 *
 * @param session - 추적 세션 데이터
 * @param apiKey - OpenAI API 키 (빈 문자열이면 Copilot만 사용)
 * @param token - 취소 토큰
 * @returns 생성된 리포트 (Markdown 텍스트)
 */
export async function generateReport(
    session: TrackingSession,
    apiKey: string,
    token: vscode.CancellationToken
): Promise<{ report: string; model: string; provider: string }> {
    const messages: LlmMessage[] = [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: buildReportPrompt(session) },
    ];

    const result = await sendLlmRequest(messages, apiKey, token);

    return {
        report: result.text,
        model: result.model,
        provider: result.provider,
    };
}

/**
 * 추적 데이터가 부족할 때 LLM 없이 간단한 리포트를 생성한다.
 */
export function generateSimpleReport(session: TrackingSession): string {
    const lines: string[] = [];
    const duration = session.endedAt
        ? getTimeDiff(session.startedAt, session.endedAt)
        : '진행 중';

    lines.push(`## 📋 작업 요약: ${session.issueKey}`);
    lines.push(`- 작업 시간: ${duration}`);
    lines.push('');

    if (session.fileChanges.length > 0) {
        lines.push(`## 📂 변경된 파일 (${session.fileChanges.length})`);
        for (const fc of session.fileChanges) {
            lines.push(`- [${fc.changeType}] \`${fc.filePath}\``);
        }
        lines.push('');
    }

    if (session.terminalEntries.length > 0) {
        lines.push(`## 💻 실행 명령어 (${session.terminalEntries.length})`);
        for (const te of session.terminalEntries) {
            const status = te.exitCode === 0 ? '✅' : te.exitCode !== undefined ? '❌' : '⏳';
            lines.push(`- ${status} \`${te.command}\``);
        }
        lines.push('');
    }

    if (session.chatEntries.length > 0) {
        lines.push(`## 💬 AI 대화 (${session.chatEntries.length}건)`);
    }

    return lines.join('\n');
}

/** 시간 차이를 사람이 읽기 쉬운 형태로 변환 */
function getTimeDiff(start: string, end: string): string {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (hours > 0) {
        return `${hours}시간 ${mins}분`;
    }
    return `${mins}분`;
}
