import type { WebviewToExtMessage } from '../../../src/webviewProtocol';

interface ActionPanelProps {
  issueKey: string;
  markdown: string;
  isEditing: boolean;
  disabled: boolean;
  onEdit: () => void;
  postMessage: (msg: WebviewToExtMessage) => void;
}

/**
 * 하단 액션 버튼바.
 *
 * 리포트 완성 후 사용자가 최종 목적지를 선택하는 컨트롤 패널.
 * - 트래커 전송 (Jira/GitHub 코멘트 등록)
 * - 로컬 저장 (.omnisync/reports/)
 * - 클립보드 복사
 * - 수정 모드 전환
 * - 재작성 요청
 */
export function ActionPanel({
  issueKey,
  markdown,
  isEditing,
  disabled,
  onEdit,
  postMessage,
}: ActionPanelProps) {
  const handleSendToTracker = () => {
    postMessage({
      type: 'action:sendToTracker',
      payload: { issueKey, markdown },
    });
  };

  const handleSaveLocal = () => {
    postMessage({
      type: 'action:saveLocal',
      payload: { issueKey, markdown },
    });
  };

  const handleCopyClipboard = () => {
    postMessage({
      type: 'action:copyClipboard',
      payload: { markdown },
    });
  };

  const handleRegenerate = () => {
    const userNote = window.prompt('재작성 시 참고할 추가 지시사항이 있나요? (선택)');
    postMessage({
      type: 'action:regenerate',
      payload: { issueKey, userNote: userNote ?? undefined },
    });
  };

  return (
    <div className="action-panel">
      <button
        className="btn-success"
        onClick={handleSendToTracker}
        disabled={disabled || isEditing}
        title="이슈 트래커에 코멘트로 등록"
      >
        🚀 트래커 전송
      </button>

      <button
        className="btn-primary"
        onClick={handleSaveLocal}
        disabled={disabled || isEditing}
        title="로컬 .omnisync/reports/ 에 저장"
      >
        💾 로컬 저장
      </button>

      <button
        className="btn-secondary"
        onClick={handleCopyClipboard}
        disabled={disabled || isEditing}
        title="클립보드에 복사"
      >
        📋 복사
      </button>

      <div className="spacer" />

      <button
        className="btn-outline"
        onClick={onEdit}
        disabled={disabled}
        title="리포트 직접 수정"
      >
        ✏️ {isEditing ? '미리보기' : '수정'}
      </button>

      <button
        className="btn-outline"
        onClick={handleRegenerate}
        disabled={disabled || isEditing}
        title="AI에게 재작성 요청"
      >
        🔄 재작성
      </button>
    </div>
  );
}
