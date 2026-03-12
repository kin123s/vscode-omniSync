import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ReportViewerProps {
  markdown: string;
}

/**
 * 인수인계서 Markdown 렌더러 컴포넌트.
 *
 * react-markdown + remark-gfm으로 GFM(GitHub Flavored Markdown) 렌더링.
 * 테이블, 체크리스트, 취소선, 코드 블록 등 모두 지원.
 */
export function ReportViewer({ markdown }: ReportViewerProps) {
  if (!markdown.trim()) {
    return (
      <div className="empty-state">
        <div className="icon">📄</div>
        <p>리포트가 아직 생성되지 않았습니다.</p>
      </div>
    );
  }

  return (
    <div className="report-viewer">
      <Markdown remarkPlugins={[remarkGfm]}>
        {markdown}
      </Markdown>
    </div>
  );
}
