import * as vscode from 'vscode';

export class TerminalListener {
  private disposables: vscode.Disposable[] = [];
  private logBuffer: string[] = [];
  
  // 보안을 위한 필터링 정규식 (토큰, 비밀번호 등 마스킹)
  private readonly SENSITIVE_PATTERN = /(Bearer\s+|token=|password=|secret=)([A-Za-z0-9\-\._~+\/]+=*)/gi;

  constructor() {
    // 주의: onDidWriteTerminalData는 1.84+ 등 최신 API 제안이거나 특정 상황에 활성화됨.
    // 현재는 Pseudoterminal API 또는 Task 훅 등을 우회/혼합 사용할 수도 있음.
    // 여기서는 개념 증명으로 타입 방어형 로직 작성.
    if ((vscode.window as any).onDidWriteTerminalData) {
      this.disposables.push(
        (vscode.window as any).onDidWriteTerminalData((e: any) => {
          this.handleData(e.data);
        })
      );
    }
  }

  private handleData(data: string) {
    if (!data) return;
    
    // 1. 민감 정보 마스킹 (보안 정책 반영)
    const sanitized = data.replace(this.SENSITIVE_PATTERN, '$1[FILTERED_SECRET]');
    
    // 2. 버퍼에 저장 (용량 제한)
    this.logBuffer.push(sanitized);
    if (this.logBuffer.length > 1000) {
      this.logBuffer.shift(); // 오래된 로그 밀어내기
    }
  }

  /**
   * 버퍼에 저장된 필터링된 로그를 반환합니다.
   */
  public getLogs(): string {
    return this.logBuffer.join('');
  }

  /** extension.ts 호환 alias */
  public getLog(): string {
    return this.getLogs();
  }

  /** 추적 시작 (버퍼 초기화 포함) */
  public startListening(): void {
    this.clear();
  }

  /** 추적 중지 */
  public stopListening(): void {
    // 현재는 생성자에서 이벤트 핸들러 등록 완료 상태 — 필요 시 확장
  }

  /**
   * 버퍼 초기화 (새로운 태스크 시작 시 호출)
   */
  public clear() {
    this.logBuffer = [];
  }

  public dispose() {
    this.disposables.forEach(d => d.dispose());
  }
}
