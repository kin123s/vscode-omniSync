import * as vscode from 'vscode';

/**
 * LLM 서비스 추상화 레이어.
 *
 * 1순위: VS Code 내장 Copilot 모델 (vscode.lm API)
 * 2순위: OpenAI 호환 API (사용자 제공 API Key)
 *
 * 두 방식 모두 동일한 인터페이스로 호출할 수 있도록 추상화한다.
 */

/** LLM에 보낼 메시지 역할 */
export type MessageRole = 'system' | 'user' | 'assistant';

/** LLM 메시지 단위 */
export interface LlmMessage {
    role: MessageRole;
    content: string;
}

/** LLM 호출 결과 */
export interface LlmResult {
    text: string;
    model: string;
    provider: 'copilot' | 'openai-compatible';
}

// ─── VS Code 내장 Copilot 모델 사용 ───

/**
 * vscode.lm API를 통해 Copilot 모델에 요청을 보낸다.
 * Copilot이 설치되어 있지 않거나 사용자 동의가 없으면 null을 반환한다.
 *
 * @param messages - 프롬프트 메시지 배열
 * @param token - 취소 토큰
 * @returns LLM 응답 텍스트 또는 null (사용 불가 시)
 */
async function requestViaCopilot(
    messages: LlmMessage[],
    token: vscode.CancellationToken
): Promise<LlmResult | null> {
    try {
        // Copilot 모델 선택 (gpt-4o 우선)
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });

        if (models.length === 0) {
            // gpt-4o가 없으면 아무 Copilot 모델이라도 시도
            const fallbackModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (fallbackModels.length === 0) {
                return null; // Copilot 모델 사용 불가
            }
            return await sendCopilotRequest(fallbackModels[0], messages, token);
        }

        return await sendCopilotRequest(models[0], messages, token);
    } catch (err) {
        if (err instanceof vscode.LanguageModelError) {
            console.warn(`Copilot LLM 오류: ${err.message} (code: ${err.code})`);
        }
        return null; // fallback으로 넘어감
    }
}

/**
 * 선택된 Copilot 모델에 실제 요청을 보내고 스트리밍 응답을 수집한다.
 */
async function sendCopilotRequest(
    model: vscode.LanguageModelChat,
    messages: LlmMessage[],
    token: vscode.CancellationToken
): Promise<LlmResult> {
    // LlmMessage → vscode.LanguageModelChatMessage 변환
    const vsMessages = messages.map(msg => {
        switch (msg.role) {
            case 'system':
                // vscode.lm에서는 system 메시지가 없으므로 User로 대체
                return vscode.LanguageModelChatMessage.User(`[System Instructions]\n${msg.content}`);
            case 'assistant':
                return vscode.LanguageModelChatMessage.Assistant(msg.content);
            case 'user':
            default:
                return vscode.LanguageModelChatMessage.User(msg.content);
        }
    });

    const response = await model.sendRequest(vsMessages, {}, token);

    // 스트리밍 응답을 단일 문자열로 수집
    const chunks: string[] = [];
    for await (const fragment of response.text) {
        chunks.push(fragment);
    }

    return {
        text: chunks.join(''),
        model: model.name ?? model.id,
        provider: 'copilot',
    };
}

// ─── OpenAI 호환 API Fallback ───

/**
 * OpenAI 호환 API(예: OpenAI, Azure OpenAI)를 직접 호출한다.
 * Settings의 llmApiKey를 사용한다.
 *
 * @param messages - 프롬프트 메시지 배열
 * @param apiKey - OpenAI API 키
 * @returns LLM 응답 텍스트
 */
async function requestViaOpenAI(
    messages: LlmMessage[],
    apiKey: string
): Promise<LlmResult> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const body = {
        model: 'gpt-4o',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature: 0.3,
        max_tokens: 4096,
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(
            `OpenAI API 호출 실패 [${response.status}]: ${response.statusText}\n${errBody}`
        );
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content ?? '';

    return {
        text,
        model: data.model ?? 'gpt-4o',
        provider: 'openai-compatible',
    };
}

// ─── 통합 인터페이스 ───

/**
 * LLM에 메시지를 전송한다 (Copilot 우선 → OpenAI fallback).
 *
 * @param messages - 프롬프트 메시지 배열
 * @param apiKey - OpenAI API 키 (빈 문자열이면 Copilot만 시도)
 * @param token - 취소 토큰
 * @returns LLM 응답 결과
 * @throws Copilot과 OpenAI 모두 사용 불가 시 에러
 */
export async function sendLlmRequest(
    messages: LlmMessage[],
    apiKey: string,
    token: vscode.CancellationToken
): Promise<LlmResult> {
    // 1) Copilot 모델 시도
    const copilotResult = await requestViaCopilot(messages, token);
    if (copilotResult) {
        return copilotResult;
    }

    // 2) Copilot 사용 불가 → OpenAI fallback
    if (apiKey) {
        return await requestViaOpenAI(messages, apiKey);
    }

    // 3) 둘 다 불가
    throw new Error(
        'LLM을 사용할 수 없습니다.\n' +
        '- GitHub Copilot이 설치되어 있는지 확인하거나\n' +
        '- Settings에서 LLM API Key를 입력해 주세요.'
    );
}
