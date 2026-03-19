/**
 * Orx — 글로벌 OutputChannel 로거.
 *
 * 에러를 조용히 삼키지 않고, Output 패널에 기록하여
 * 디버깅 및 관측 가능성(Observability)을 확보합니다.
 *
 * 사용법:
 *   import { logger } from './utils/logger';
 *   logger.info('리포트 생성 시작');
 *   logger.error('LLM 요청 실패', err);
 */
import * as vscode from 'vscode';

class OrxLogger {
    private channel: vscode.OutputChannel | undefined;

    /** OutputChannel 초기화. activate() 시점에 한 번 호출. */
    init(): void {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('Orx');
        }
    }

    info(message: string): void {
        this.write('INFO', message);
    }

    warn(message: string): void {
        this.write('WARN', message);
    }

    error(message: string, err?: unknown): void {
        const detail = err instanceof Error ? ` — ${err.message}` : '';
        this.write('ERROR', `${message}${detail}`);
    }

    /** Output 패널을 사용자에게 표시 */
    show(): void {
        this.channel?.show(true);
    }

    private write(level: string, message: string): void {
        const timestamp = new Date().toISOString().substring(11, 19);
        const line = `[${timestamp}] [${level}] ${message}`;
        this.channel?.appendLine(line);
        // 콘솔에도 출력 (Extension Host 디버깅용)
        if (level === 'ERROR') {
            console.error(`[Orx] ${message}`);
        }
    }
}

/** 싱글턴 로거 인스턴스 */
export const logger = new OrxLogger();
