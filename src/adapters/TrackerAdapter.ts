export interface IssueContext {
  id: string;
  title: string;
  description: string;
  status: string;
  url: string;
  metadata?: Record<string, any>;
}

export interface TrackerAdapter {
  /**
   * 고유한 어댑터 식별자 (예: 'jira', 'github')
   */
  readonly id: string;
  
  /**
   * 현재 할당되거나 활성화된 이슈/작업 목록을 가져옵니다.
   */
  fetchActiveIssues(): Promise<IssueContext[]>;
  
  /**
   * 특정 이슈의 세부 정보를 가져옵니다.
   */
  fetchIssueDetails(issueId: string): Promise<IssueContext>;
  
  /**
   * 작업 결과를 바탕으로 이슈의 상태나 코멘트를 업데이트합니다.
   */
  updateIssue(issueId: string, comment: string, newStatus?: string): Promise<boolean>;
}
