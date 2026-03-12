import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { TrackerAdapter } from '../adapters/TrackerAdapter';

export class ExportManager {
  /**
   * 생성된 페이로드(마크다운)를 시스템 클립보드에 복사합니다.
   * 이렇게 하면 사용자가 Cursor, ChatGPT, Claude 등에 즉시 붙여넣을 수 있습니다.
   */
  public async exportToClipboard(payload: string): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(payload);
      vscode.window.showInformationMessage('📋 리포트가 클립보드에 복사되었습니다.');
      return true;
    } catch (error) {
      console.error('클립보드 복사 실패:', error);
      vscode.window.showErrorMessage('클립보드 복사에 실패했습니다.');
      return false;
    }
  }

  /**
   * 리포트를 로컬 파일로 Append 저장합니다.
   * 경로: {workspaceRoot}/.omnisync/reports/{issueKey}.md
   *
   * 같은 이슈 키의 파일이 이미 있으면 구분선과 함께 append.
   */
  public async exportToLocalFile(issueKey: string, markdown: string): Promise<boolean> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('열린 워크스페이스가 없습니다.');
        return false;
      }

      const reportsDir = path.join(workspaceFolder.uri.fsPath, '.omnisync', 'reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filePath = path.join(reportsDir, `${issueKey}.md`);
      const timestamp = new Date().toISOString();
      const separator = `\n\n---\n\n> 📝 Updated: ${timestamp}\n\n`;

      if (fs.existsSync(filePath)) {
        // Append 모드
        fs.appendFileSync(filePath, separator + markdown, 'utf-8');
      } else {
        // 신규 생성
        const header = `# ${issueKey} — 작업 리포트\n\n> 🕐 Created: ${timestamp}\n\n`;
        fs.writeFileSync(filePath, header + markdown, 'utf-8');
      }

      vscode.window.showInformationMessage(`💾 ${issueKey} 리포트 저장 완료 → .omnisync/reports/${issueKey}.md`);

      // 저장된 파일 열기
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

      return true;
    } catch (error) {
      console.error('로컬 파일 저장 실패:', error);
      vscode.window.showErrorMessage(`로컬 파일 저장 실패: ${error}`);
      return false;
    }
  }

  /**
   * 트래커(Jira, GitHub 등)에 리포트를 코멘트로 전송합니다.
   */
  public async exportToTracker(
    adapter: TrackerAdapter,
    issueKey: string,
    markdown: string,
  ): Promise<boolean> {
    try {
      const result = await adapter.updateIssue(issueKey, markdown);
      if (result) {
        vscode.window.showInformationMessage(`🚀 ${issueKey}에 리포트가 등록되었습니다.`);
      } else {
        vscode.window.showWarningMessage(`${issueKey} 리포트 등록에 실패했습니다.`);
      }
      return result;
    } catch (error) {
      console.error('트래커 전송 실패:', error);
      vscode.window.showErrorMessage(`트래커 전송 실패: ${error}`);
      return false;
    }
  }

  /**
   * (향후 확장) 외부 LLM API(예: OpenAI, Anthropic)로 직접 페이로드를 전송합니다.
   */
  public async exportToLlmApi(_payload: string, _endpoint: string, _apiKey: string): Promise<string> {
    // TODO: Fetch API 등을 사용한 직접 전송 로직
    throw new Error('Not implemented yet');
  }

  /**
   * extension.ts 호환 alias — exportToClipboard()를 위임합니다.
   */
  public async export(payload: string): Promise<boolean> {
    return this.exportToClipboard(payload);
  }
}
