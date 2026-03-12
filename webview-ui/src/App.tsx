import { useState, useCallback } from 'react';
import { useVsCodeMessage } from './hooks/useVsCodeMessage';
import { ReportViewer } from './components/ReportViewer';
import { ReportEditor } from './components/ReportEditor';
import { ActionPanel } from './components/ActionPanel';
import type { ExtToWebviewMessage } from './types/webviewProtocol';

interface AppState {
  markdown: string;
  issueKey: string;
  metadata: Record<string, unknown>;
  status: 'loading' | 'ready' | 'error';
  statusMessage?: string;
}

/**
 * OmniSync Webview 메인 앱.
 *
 * Extension Host에서 전달된 리포트 데이터를 렌더링하고,
 * 사용자의 액션(트래커 전송, 로컬 저장, 클립보드 복사, 수정, 재작성)을
 * postMessage로 Extension Host에 위임한다.
 */
export function App() {
  const [state, setState] = useState<AppState>({
    markdown: '',
    issueKey: '',
    metadata: {},
    status: 'loading',
    statusMessage: '리포트를 생성하고 있습니다...',
  });
  const [isEditing, setIsEditing] = useState(false);

  // Extension Host → Webview 메시지 수신
  const handleMessage = useCallback((message: ExtToWebviewMessage) => {
    switch (message.type) {
      case 'reportData':
        setState({
          markdown: message.payload.markdown,
          issueKey: message.payload.issueKey,
          metadata: message.payload.metadata,
          status: 'ready',
        });
        break;

      case 'updateStatus':
        setState((prev) => ({
          ...prev,
          status: message.payload.status,
          statusMessage: message.payload.message,
        }));
        break;

      case 'platformInfo':
        setState((prev) => ({
          ...prev,
          metadata: {
            ...prev.metadata,
            platform: message.payload.platform,
            connected: message.payload.connected,
          },
        }));
        break;
    }
  }, []);

  const { postMessage } = useVsCodeMessage(handleMessage);

  // 에디터에서 저장 → markdown 업데이트 + 뷰어 모드로 전환
  const handleEditorSave = useCallback((updatedMarkdown: string) => {
    setState((prev) => ({ ...prev, markdown: updatedMarkdown }));
    setIsEditing(false);

    // Extension Host에도 변경 사항 알림
    postMessage({
      type: 'action:editReport',
      payload: { markdown: updatedMarkdown },
    });
  }, [postMessage]);

  const toggleEditMode = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  // ─── 렌더링 ───

  return (
    <div className="app-container">
      {/* 헤더 */}
      <div className="app-header">
        <h1>OmniSync Report</h1>
        {state.issueKey && (
          <span className="issue-badge">{state.issueKey}</span>
        )}
        {typeof state.metadata.provider === 'string' && (
          <span className="meta-info">
            {state.metadata.provider} · {String(state.metadata.model ?? '')}
          </span>
        )}
      </div>

      {/* 상태 표시 */}
      {state.status !== 'ready' && (
        <div className={`status-bar ${state.status}`}>
          {state.status === 'loading' && <div className="spinner" />}
          {state.status === 'error' && '⚠️'}
          <span>{state.statusMessage ?? state.status}</span>
        </div>
      )}

      {/* 메인 콘텐츠 영역 */}
      {state.status === 'ready' && !isEditing && (
        <ReportViewer markdown={state.markdown} />
      )}

      {state.status === 'ready' && isEditing && (
        <ReportEditor
          markdown={state.markdown}
          onSave={handleEditorSave}
          onCancel={() => setIsEditing(false)}
        />
      )}

      {/* 빈 상태 (로딩 아닌데 데이터 없음) */}
      {state.status === 'ready' && !state.markdown.trim() && !isEditing && (
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>생성된 리포트가 없습니다. 작업을 추적한 후 "Finish & Report"를 실행하세요.</p>
        </div>
      )}

      {/* 액션 패널 */}
      {state.status === 'ready' && state.markdown.trim() && (
        <ActionPanel
          issueKey={state.issueKey}
          markdown={state.markdown}
          isEditing={isEditing}
          disabled={state.status !== 'ready'}
          onEdit={toggleEditMode}
          postMessage={postMessage}
        />
      )}
    </div>
  );
}
