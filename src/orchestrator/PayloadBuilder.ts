import { IssueContext } from '../adapters/TrackerAdapter';

export interface WorkflowContext {
  issue: IssueContext | null;
  gitDiff: string;
  terminalLogs: string;
  testResults?: string;
  userNotes?: string;
}

export class PayloadBuilder {
  /**
   * 수집된 컨텍스트를 LLM/에이전트가 이해할 수 있는 통합 프롬프트(마크다운)로 렌더링합니다.
   */
  public buildMarkdown(context: WorkflowContext): string {
    const lines: string[] = [];

    // 1. 헤더 (이슈 컨텍스트)
    if (context.issue) {
      lines.push(`## [목적/이슈] ${context.issue.title} (#${context.issue.id})`);
      lines.push(`URL: ${context.issue.url}`);
      lines.push(`Description:\n${context.issue.description}\n`);
    } else {
      lines.push('## [목적/이슈]');
      lines.push('명시된 연결된 이슈가 없습니다.\n');
    }

    // 2. Git Diff 컨텍스트
    lines.push('## [코드 변경 사항 (Git Diff)]');
    if (context.gitDiff && context.gitDiff.trim() !== '') {
      lines.push('```diff\n' + context.gitDiff + '\n```\n');
    } else {
      lines.push('수정된 코드(Uncommitted changes)가 없습니다.\n');
    }

    // 3. 터미널 및 테스트 로그
    lines.push('## [터미널 및 빌드/테스트 로그]');
    if (context.terminalLogs && context.terminalLogs.trim() !== '') {
      lines.push('```bash\n' + context.terminalLogs + '\n```\n');
    } else {
      lines.push('최근 터미널 실행 기록이 없습니다.\n');
    }

    // 4. (옵션) 사용자 메모
    if (context.userNotes) {
      lines.push('## [사용자 추가 노트]');
      lines.push(context.userNotes + '\n');
    }

    return lines.join('\n');
  }

  /**
   * extension.ts 호환 인터페이스 — buildMarkdown()을 위임합니다.
   */
  public build(params: {
    issueId: string;
    report: string;
    gitDiff: string;
    terminalLog: string;
    fileChanges: unknown[];
  }): string {
    return this.buildMarkdown({
      issue: {
        id: params.issueId,
        title: params.issueId,
        description: params.report,
        status: '',
        url: '',
      },
      gitDiff: params.gitDiff,
      terminalLogs: params.terminalLog,
    });
  }
}
