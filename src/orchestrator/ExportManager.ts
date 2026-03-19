import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { TrackerAdapter } from '../adapters/TrackerAdapter';

export class ExportManager {
  /**
   * ?앹꽦???섏씠濡쒕뱶(留덊겕?ㅼ슫)瑜??쒖뒪???대┰蹂대뱶??蹂듭궗?⑸땲??
   * ?대젃寃??섎㈃ ?ъ슜?먭? Cursor, ChatGPT, Claude ?깆뿉 利됱떆 遺숈뿬?ｌ쓣 ???덉뒿?덈떎.
   */
  public async exportToClipboard(payload: string): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(payload);
      vscode.window.showInformationMessage('?뱥 由ы룷?멸? ?대┰蹂대뱶??蹂듭궗?섏뿀?듬땲??');
      return true;
    } catch (error) {
      console.error('?대┰蹂대뱶 蹂듭궗 ?ㅽ뙣:', error);
      vscode.window.showErrorMessage('?대┰蹂대뱶 蹂듭궗???ㅽ뙣?덉뒿?덈떎.');
      return false;
    }
  }

  /**
   * 由ы룷?몃? 濡쒖뺄 ?뚯씪濡?Append ??ν빀?덈떎.
   * 寃쎈줈: {workspaceRoot}/.orx/reports/{issueKey}.md
   *
   * 媛숈? ?댁뒋 ?ㅼ쓽 ?뚯씪???대? ?덉쑝硫?援щ텇?좉낵 ?④퍡 append.
   */
  public async exportToLocalFile(issueKey: string, markdown: string): Promise<boolean> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('?대┛ ?뚰겕?ㅽ럹?댁뒪媛 ?놁뒿?덈떎.');
        return false;
      }

      const reportsDir = path.join(workspaceFolder.uri.fsPath, '.orx', 'reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const filePath = path.join(reportsDir, `${issueKey}.md`);
      const timestamp = new Date().toISOString();
      const separator = `\n\n---\n\n> ?뱷 Updated: ${timestamp}\n\n`;

      if (fs.existsSync(filePath)) {
        // Append 紐⑤뱶
        fs.appendFileSync(filePath, separator + markdown, 'utf-8');
      } else {
        // ?좉퇋 ?앹꽦
        const header = `# ${issueKey} ???묒뾽 由ы룷??n\n> ?븧 Created: ${timestamp}\n\n`;
        fs.writeFileSync(filePath, header + markdown, 'utf-8');
      }

      vscode.window.showInformationMessage(`?뮶 ${issueKey} 由ы룷??????꾨즺 ??.orx/reports/${issueKey}.md`);

      // ??λ맂 ?뚯씪 ?닿린
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

      return true;
    } catch (error) {
      console.error('濡쒖뺄 ?뚯씪 ????ㅽ뙣:', error);
      vscode.window.showErrorMessage(`濡쒖뺄 ?뚯씪 ????ㅽ뙣: ${error}`);
      return false;
    }
  }

  /**
   * ?몃옒而?Jira, GitHub ????由ы룷?몃? 肄붾찘?몃줈 ?꾩넚?⑸땲??
   */
  public async exportToTracker(
    adapter: TrackerAdapter,
    issueKey: string,
    markdown: string,
  ): Promise<boolean> {
    try {
      const result = await adapter.updateIssue(issueKey, markdown);
      if (result) {
        vscode.window.showInformationMessage(`?? ${issueKey}??由ы룷?멸? ?깅줉?섏뿀?듬땲??`);
      } else {
        vscode.window.showWarningMessage(`${issueKey} 由ы룷???깅줉???ㅽ뙣?덉뒿?덈떎.`);
      }
      return result;
    } catch (error) {
      console.error('?몃옒而??꾩넚 ?ㅽ뙣:', error);
      vscode.window.showErrorMessage(`?몃옒而??꾩넚 ?ㅽ뙣: ${error}`);
      return false;
    }
  }

  /**
   * (?ν썑 ?뺤옣) ?몃? LLM API(?? OpenAI, Anthropic)濡?吏곸젒 ?섏씠濡쒕뱶瑜??꾩넚?⑸땲??
   */
  public async exportToLlmApi(_payload: string, _endpoint: string, _apiKey: string): Promise<string> {
    // TODO: Fetch API ?깆쓣 ?ъ슜??吏곸젒 ?꾩넚 濡쒖쭅
    throw new Error('Not implemented yet');
  }

  /**
   * extension.ts ?명솚 alias ??exportToClipboard()瑜??꾩엫?⑸땲??
   */
  public async export(payload: string): Promise<boolean> {
    return this.exportToClipboard(payload);
  }
}
