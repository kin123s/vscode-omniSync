/**
 * Orx Work Session 데이터 모델.
 *
 * 하나의 Work Session은 하나 이상의 이슈/커밋/이벤트를 포함하는
 * 논리적 작업 단위를 표현합니다.
 *
 * 기존 TrackingSession(memory.ts)을 대체하며,
 * 커밋 히스토리, 경량 이벤트 로그, 변경 분류 결과를 추가로 포함합니다.
 */

// ─── 이벤트 타입 정의 ───

/** 사용자가 명시적으로 남긴 메모 */
export interface NoteEvent {
    type: 'note';
    content: string;
    timestamp: string;
}

/** 테스트 실행 결과 */
export interface TestEvent {
    type: 'test';
    result: 'pass' | 'fail';
    detail?: string;
    timestamp: string;
}

/** 세션 이벤트 합집합 (비간섭 원칙: 사용자 명시 + 결과만) */
export type SessionEvent = NoteEvent | TestEvent;

// ─── 변경 분류 결과 ───

export interface ChangeClassification {
    categories: string[];    // 예: ['API 변경', 'DB 변경']
    filesSummary: string;    // git diff --stat 요약
}

// ─── Work Session 핵심 모델 ───

export interface WorkSession {
    /** 고유 식별자 (UUID v4) */
    id: string;

    /** 세션 시작 시각 (ISO 8601) */
    startedAt: string;

    /** 세션 종료 시각 (ISO 8601). 미종료 시 undefined */
    endedAt?: string;

    /** 세션 시작 시점의 Git HEAD 커밋 해시 */
    baseCommitHash: string;

    /** 연결된 이슈 키 목록 (예: ['PROJ-123', 'PROJ-456']) */
    issues: string[];

    /** 세션 중 발생한 커밋 해시 목록 (시간순) */
    commits: string[];

    /** 경량 이벤트 로그 */
    events: SessionEvent[];

    /** 변경 분류 결과 (세션 종료 시 산출) */
    changeClassification?: ChangeClassification;

    /** 세션 상태 */
    status: 'active' | 'completed' | 'abandoned';
}

// ─── 레거시 호환 타입 (기존 TrackingSession 필드 매핑) ───

/** 터미널 명령 실행 기록 */
export interface TerminalEntry {
    command: string;
    cwd: string;
    timestamp: string;
    exitCode?: number;
}

/** 파일 변경 기록 */
export interface FileChangeEntry {
    filePath: string;
    changeType: 'modified' | 'created' | 'deleted';
    timestamp: string;
    diff?: string;
}

/** AI 채팅 기록 (Chat Participant 캐처부) */
export interface ChatEntry {
    participant: string;
    userMessage: string;
    assistantResponse: string;
    timestamp: string;
}

/**
 * 확장된 Work Session (레거시 필드 포함).
 *
 * 기존 MemoryManager가 사용하던 TrackingSession의 필드를 유지하면서
 * 새로운 WorkSession 필드를 추가합니다.
 */
export interface ExtendedWorkSession extends WorkSession {
    /** 기존 issueKey 호환 (issues[0]의 alias) */
    issueKey: string;

    /** 터미널 명령 기록 (기존 L2 수집) */
    terminalEntries: TerminalEntry[];

    /** 파일 변경 기록 (기존 L1 수집) */
    fileChanges: FileChangeEntry[];

    /** AI 채팅 기록 */
    chatEntries: ChatEntry[];
}

/**
 * 새 ExtendedWorkSession을 생성합니다.
 */
export function createWorkSession(
    issueKey: string,
    baseCommitHash: string,
): ExtendedWorkSession {
    return {
        id: generateId(),
        startedAt: new Date().toISOString(),
        baseCommitHash,
        issues: [issueKey],
        commits: [],
        events: [],
        status: 'active',

        // 레거시 호환 필드
        issueKey,
        terminalEntries: [],
        fileChanges: [],
        chatEntries: [],
    };
}

/**
 * 세션 이벤트 타임라인을 텍스트 형태로 생성합니다.
 * Replay 기능의 텍스트 기반 대체.
 */
export function buildTimeline(session: ExtendedWorkSession): string[] {
    const lines: string[] = [];

    lines.push(`[START] ${session.startedAt} — ${session.issueKey}`);

    // 커밋 + 이벤트를 시간순으로 merge할 수는 없으므로 (커밋에 타임스탬프 없음)
    // 구조별로 출력
    for (const commit of session.commits) {
        lines.push(`[COMMIT] ${commit.substring(0, 8)}`);
    }

    for (const event of session.events) {
        if (event.type === 'note') {
            lines.push(`[NOTE] ${event.timestamp} — ${event.content}`);
        } else if (event.type === 'test') {
            lines.push(`[TEST] ${event.timestamp} — ${event.result}${event.detail ? ': ' + event.detail : ''}`);
        }
    }

    if (session.changeClassification) {
        lines.push(`[CLASSIFICATION] ${session.changeClassification.categories.join(', ')}`);
    }

    if (session.endedAt) {
        lines.push(`[END] ${session.endedAt}`);
    }

    return lines;
}

// ─── 유틸리티 ───

function generateId(): string {
    // crypto.randomUUID()는 Node 19+ 에서만 사용 가능.
    // VS Code Extension 환경에서는 간단한 UUID v4 구현 사용.
    const hex = (n: number) => Math.floor(Math.random() * (16 ** n)).toString(16).padStart(n, '0');
    return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}
