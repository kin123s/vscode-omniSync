import * as vscode from 'vscode';
import type {
    ExtendedWorkSession,
    SessionEvent,
    TerminalEntry,
    FileChangeEntry,
    ChatEntry,
} from './models/WorkSession';
import { createWorkSession } from './models/WorkSession';

// 타입 re-export (기존 import 호환 유지)
export type { TerminalEntry, FileChangeEntry, ChatEntry };
/** @deprecated TrackingSession → ExtendedWorkSession 으로 전환. 하위 호환용 alias */
export type TrackingSession = ExtendedWorkSession;

// ─── Memory Manager ───

const STORAGE_KEY = 'orx.sessions';
const ACTIVE_KEY = 'orx.activeSessionId';
const MAX_HISTORY = 20;

export class MemoryManager {
    constructor(private readonly state: vscode.Memento) {}

    // ─── 세션 생명주기 ───

    /** 새 추적 세션을 시작합니다. 기존 활성 세션은 덮어씁니다. */
    async startSession(issueKey: string, baseCommitHash?: string): Promise<ExtendedWorkSession> {
        const session = createWorkSession(issueKey, baseCommitHash ?? '');
        await this.saveSession(session);
        await this.state.update(ACTIVE_KEY, session.id);
        return session;
    }

    /** 세션을 종료하고 최종 데이터를 반환합니다. */
    async endSession(): Promise<ExtendedWorkSession | null> {
        const session = this.getSession();
        if (!session) {
            return null;
        }
        session.endedAt = new Date().toISOString();
        session.status = 'completed';
        await this.saveSession(session);
        return session;
    }

    /** 활성 세션을 삭제합니다. */
    async clearSession(): Promise<void> {
        await this.state.update(ACTIVE_KEY, undefined);
    }

    // ─── 세션 조회 ───

    /** 현재 활성 세션을 가져옵니다. 없으면 null. */
    getSession(): ExtendedWorkSession | null {
        const activeId = this.state.get<string>(ACTIVE_KEY);
        if (!activeId) { return null; }

        const sessions = this.getAllSessions();
        return sessions.find(s => s.id === activeId) ?? null;
    }

    /** 저장된 모든 세션(히스토리)을 반환합니다. */
    getAllSessions(): ExtendedWorkSession[] {
        return this.state.get<ExtendedWorkSession[]>(STORAGE_KEY) ?? [];
    }

    /** 활성 세션 목록 (하위 호환) */
    getActiveSessions(): ExtendedWorkSession[] {
        const session = this.getSession();
        return session ? [session] : [];
    }

    // ─── 데이터 추가 메서드 (기존 호환) ───

    /** 터미널 명령어 기록 추가 */
    async addTerminalEntry(entry: TerminalEntry): Promise<void> {
        const session = this.getSession();
        if (!session) { return; }
        session.terminalEntries.push(entry);
        await this.saveSession(session);
    }

    /** 파일 변경 기록 추가 (같은 파일은 최신으로 갱신) */
    async addFileChange(entry: FileChangeEntry): Promise<void> {
        const session = this.getSession();
        if (!session) { return; }

        const existingIdx = session.fileChanges.findIndex(
            fc => fc.filePath === entry.filePath,
        );
        if (existingIdx >= 0) {
            session.fileChanges[existingIdx] = entry;
        } else {
            session.fileChanges.push(entry);
        }

        await this.saveSession(session);
    }

    /** AI 채팅 기록 추가 */
    async addChatEntry(entry: ChatEntry): Promise<void> {
        const session = this.getSession();
        if (!session) { return; }
        session.chatEntries.push(entry);
        await this.saveSession(session);
    }

    // ─── 신규: Work Session 확장 메서드 ───

    /** 커밋 해시 추가 (중복 방지) */
    async addCommit(hash: string): Promise<void> {
        const session = this.getSession();
        if (!session) { return; }
        if (!session.commits.includes(hash)) {
            session.commits.push(hash);
            await this.saveSession(session);
        }
    }

    /** 이슈 키 연결 추가 (중복 방지) */
    async addIssue(issueKey: string): Promise<void> {
        const session = this.getSession();
        if (!session) { return; }
        if (!session.issues.includes(issueKey)) {
            session.issues.push(issueKey);
            await this.saveSession(session);
        }
    }

    /** 경량 이벤트 추가 (note, test만 허용 — 비간섭 원칙) */
    async addEvent(event: SessionEvent): Promise<void> {
        const session = this.getSession();
        if (!session) { return; }
        session.events.push(event);
        await this.saveSession(session);
    }

    /** 사용자 메모 추가 (편의 메서드) */
    async addNote(content: string): Promise<void> {
        await this.addEvent({
            type: 'note',
            content,
            timestamp: new Date().toISOString(),
        });
    }

    // ─── 통계 ───

    /** 현재 세션의 요약 통계를 반환합니다. */
    getStats(): { terminal: number; files: number; chats: number; commits: number; events: number } | null {
        const session = this.getSession();
        if (!session) { return null; }
        return {
            terminal: session.terminalEntries.length,
            files: session.fileChanges.length,
            chats: session.chatEntries.length,
            commits: session.commits.length,
            events: session.events.length,
        };
    }

    // ─── 내부 영속성 ───

    private async saveSession(session: ExtendedWorkSession): Promise<void> {
        const sessions = this.getAllSessions();
        const idx = sessions.findIndex(s => s.id === session.id);
        if (idx >= 0) {
            sessions[idx] = session;
        } else {
            sessions.push(session);
        }

        // 최근 MAX_HISTORY 개만 유지
        const trimmed = sessions.slice(-MAX_HISTORY);
        await this.state.update(STORAGE_KEY, trimmed);
    }
}
