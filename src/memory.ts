import * as vscode from 'vscode';

/**
 * Memory 모듈.
 *
 * VS Code `workspaceState`를 활용하여 작업 추적 데이터를
 * 구조화된 형태로 저장/조회한다.
 * 워크스페이스별로 독립적인 데이터가 유지된다.
 */

// ─── 데이터 타입 정의 ───

/** 터미널 명령어 실행 기록 */
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

/** AI 대화 기록 (Chat Participant 캡처분) */
export interface ChatEntry {
    participant: string;
    userMessage: string;
    assistantResponse: string;
    timestamp: string;
}

/** 작업 세션 전체 데이터 */
export interface TrackingSession {
    issueKey: string;
    startedAt: string;
    endedAt?: string;
    terminalEntries: TerminalEntry[];
    fileChanges: FileChangeEntry[];
    chatEntries: ChatEntry[];
}

// ─── Memory Manager ───

const STORAGE_KEY = 'universalAgent.trackingSession';

export class MemoryManager {
    constructor(private readonly state: vscode.Memento) {}

    /** 현재 활성 세션을 가져온다. 없으면 null. */
    getSession(): TrackingSession | null {
        return this.state.get<TrackingSession>(STORAGE_KEY) ?? null;
    }

    /** 새 추적 세션을 시작한다. 기존 세션은 덮어쓴다. */
    async startSession(issueKey: string): Promise<TrackingSession> {
        const session: TrackingSession = {
            issueKey,
            startedAt: new Date().toISOString(),
            terminalEntries: [],
            fileChanges: [],
            chatEntries: [],
        };
        await this.state.update(STORAGE_KEY, session);
        return session;
    }

    /** 세션을 종료하고 최종 데이터를 반환한다. */
    async endSession(): Promise<TrackingSession | null> {
        const session = this.getSession();
        if (!session) {
            return null;
        }
        session.endedAt = new Date().toISOString();
        await this.state.update(STORAGE_KEY, session);
        return session;
    }

    /** 세션을 삭제한다. */
    async clearSession(): Promise<void> {
        await this.state.update(STORAGE_KEY, undefined);
    }

    // ─── 데이터 추가 메서드 ───

    /** 터미널 명령어 기록 추가 */
    async addTerminalEntry(entry: TerminalEntry): Promise<void> {
        const session = this.getSession();
        if (!session) {
            return;
        }
        session.terminalEntries.push(entry);
        await this.state.update(STORAGE_KEY, session);
    }

    /** 파일 변경 기록 추가 */
    async addFileChange(entry: FileChangeEntry): Promise<void> {
        const session = this.getSession();
        if (!session) {
            return;
        }

        // 같은 파일의 중복 기록 방지 (최신으로 갱신)
        const existingIdx = session.fileChanges.findIndex(
            fc => fc.filePath === entry.filePath
        );
        if (existingIdx >= 0) {
            session.fileChanges[existingIdx] = entry;
        } else {
            session.fileChanges.push(entry);
        }

        await this.state.update(STORAGE_KEY, session);
    }

    /** AI 대화 기록 추가 */
    async addChatEntry(entry: ChatEntry): Promise<void> {
        const session = this.getSession();
        if (!session) {
            return;
        }
        session.chatEntries.push(entry);
        await this.state.update(STORAGE_KEY, session);
    }

    /** 현재 세션의 요약 통계를 반환한다. */
    getStats(): { terminal: number; files: number; chats: number } | null {
        const session = this.getSession();
        if (!session) {
            return null;
        }
        return {
            terminal: session.terminalEntries.length,
            files: session.fileChanges.length,
            chats: session.chatEntries.length,
        };
    }

    /**
     * 현재 활성화된 모든 세션을 반환한다.
     * (향후 멀티 세션 구조 전환 시 확장 포인트)
     * 현재는 단일 세션만 지원하므로, 활성 세션이 있으면 1개짜리 배열을 반환한다.
     */
    getActiveSessions(): TrackingSession[] {
        const session = this.getSession();
        return session ? [session] : [];
    }
}
