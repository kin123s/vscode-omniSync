import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { TrackerAdapter } from '../adapters/TrackerAdapter';

export class ExportManager {
  /**
   * Copies the generated payload (Markdown) to the system clipboard.
   * This allows the user to paste it into Cursor, ChatGPT, Claude, etc.
   */
  public async exportToClipboard(payload: string): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(payload);
      vscode.window.showInformationMessage('📋 Report copied to clipboard.');
      return true;
    } catch (error) {
      console.error('Clipboard copy failed:', error);
      vscode.window.showErrorMessage('Failed to copy to clipboard.');
      return false;
    }
  }

  /**
   * Appends the report to a local file.
   * Path: {workspaceRoot}/.orx/reports/{issueKey}.md
   *
   * If a file for the same issue already exists, the content is appended
   * with a separator and timestamp.
   */
  public async exportToLocalFile(issueKey: string, markdown: string): Promise<boolean> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('No open workspace found.');
        return false;
      }

      const reportsDir = path.join(workspaceFolder.uri.fsPath, '.orx', 'reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filePath = path.join(reportsDir, `${issueKey}.md`);
      const timestamp = new Date().toISOString();
      const separator = `\n\n---\n\n> 📝 Updated: ${timestamp}\n\n`;

      if (fs.existsSync(filePath)) {
        // Append mode
        fs.appendFileSync(filePath, separator + markdown, 'utf-8');
      } else {
        // New file
        const header = `# ${issueKey} — Work Report\n\n> 📅 Created: ${timestamp}\n\n`;
        fs.writeFileSync(filePath, header + markdown, 'utf-8');
      }

      vscode.window.showInformationMessage(`📁 ${issueKey} report saved — .orx/reports/${issueKey}.md`);

      // Open the saved file
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

      return true;
    } catch (error) {
      console.error('Local file save failed:', error);
      vscode.window.showErrorMessage(`Local file save failed: ${error}`);
      return false;
    }
  }

  /**
   * Sends the report to the tracker (Jira, GitHub, etc.) as a comment.
   */
  public async exportToTracker(
    adapter: TrackerAdapter,
    issueKey: string,
    markdown: string,
  ): Promise<boolean> {
    try {
      const result = await adapter.updateIssue(issueKey, markdown);
      if (result) {
        vscode.window.showInformationMessage(`✅ Report posted to ${issueKey}.`);
      } else {
        vscode.window.showWarningMessage(`Failed to post report to ${issueKey}.`);
      }
      return result;
    } catch (error) {
      console.error('Tracker export failed:', error);
      vscode.window.showErrorMessage(`Tracker export failed: ${error}`);
      return false;
    }
  }

  /**
   * (Future extension) Sends the payload directly to an LLM API (e.g. OpenAI, Anthropic).
   */
  public async exportToLlmApi(_payload: string, _endpoint: string, _apiKey: string): Promise<string> {
    // TODO: Implement direct LLM API export via Fetch API
    throw new Error('Not implemented yet');
  }

  /**
   * Convenience alias — delegates to exportToClipboard().
   */
  public async export(payload: string): Promise<boolean> {
    return this.exportToClipboard(payload);
  }
}
