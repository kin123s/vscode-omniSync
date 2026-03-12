import { useState, useEffect, useRef } from 'react';

interface ReportEditorProps {
  markdown: string;
  onSave: (updatedMarkdown: string) => void;
  onCancel: () => void;
}

/**
 * 리포트 인라인 수정 에디터.
 *
 * 사용자가 AI가 생성한 인수인계서를 직접 수정할 수 있다.
 * 저장 시 변경된 마크다운을 부모에게 전달한다.
 */
export function ReportEditor({ markdown, onSave, onCancel }: ReportEditorProps) {
  const [content, setContent] = useState(markdown);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setContent(markdown);
  }, [markdown]);

  // 마운트 시 textarea에 포커스
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      // 커서를 끝으로 이동
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, []);

  const handleSave = () => {
    onSave(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+S 또는 Cmd+S로 저장
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Esc로 취소
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className="report-editor">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder="마크다운으로 리포트를 수정하세요..."
      />
      <div className="action-panel">
        <button className="btn-primary" onClick={handleSave}>
          💾 저장 (Ctrl+S)
        </button>
        <button className="btn-outline" onClick={onCancel}>
          ✖ 취소 (Esc)
        </button>
        <div className="spacer" />
        <span style={{ fontSize: '11px', color: 'var(--muted)', alignSelf: 'center' }}>
          {content.length.toLocaleString()} 자
        </span>
      </div>
    </div>
  );
}
