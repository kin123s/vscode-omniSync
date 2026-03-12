import * as vscode from 'vscode';

export class GitDiffCollector {
  private gitExtension: vscode.Extension<any> | undefined;

  constructor() {
    this.gitExtension = vscode.extensions.getExtension('vscode.git');
  }

  /**
   * Git Ext API가 활성화되어 있는지 확인하고 필요한 경우 활성화합니다.
   */
  private async ensureGitApi(): Promise<any> {
    if (!this.gitExtension) {
      throw new Error('Git extension is not available');
    }
    
    if (!this.gitExtension.isActive) {
      await this.gitExtension.activate();
    }
    
    return this.gitExtension.exports.getAPI(1);
  }

  /**
   * 현재 워크스페이스의 Git Diff(Uncommitted changes)를 텍스트 형태로 반환합니다.
   */
  public async getCurrentDiff(): Promise<string> {
    try {
      const gitApi = await this.ensureGitApi();
      if (!gitApi || !gitApi.repositories || gitApi.repositories.length === 0) {
        return 'No git repositories found.';
      }

      // 첫 번째 레포지토리를 기본으로 사용
      const repo = gitApi.repositories[0];
      
      // working tree의 변경사항(Diff) 정보 조회
      const diffStr = await repo.diff(true);
      return diffStr || 'No changes found.';
    } catch (error) {
      console.error('Failed to get git diff:', error);
      return `Error extracting git diff: ${error}`;
    }
  }

  /**
   * extension.ts 호환 alias — getCurrentDiff()를 위임합니다.
   */
  public async collect(): Promise<string> {
    return this.getCurrentDiff();
  }
}
