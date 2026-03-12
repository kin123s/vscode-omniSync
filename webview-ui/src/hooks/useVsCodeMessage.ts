import { useEffect, useCallback } from 'react';
import type { ExtToWebviewMessage, WebviewToExtMessage } from '../types/webviewProtocol';
import { getVsCodeApi } from '../vscode';

/**
 * Extension Host ↔ Webview 양방향 postMessage 통신 커스텀 훅.
 *
 * @param onMessage  Extension Host로부터 수신한 메시지 핸들러
 * @returns postMessage 전송 함수
 */
export function useVsCodeMessage(
  onMessage: (message: ExtToWebviewMessage) => void,
) {
  useEffect(() => {
    const handler = (event: MessageEvent<ExtToWebviewMessage>) => {
      onMessage(event.data);
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMessage]);

  const postMessage = useCallback((message: WebviewToExtMessage) => {
    getVsCodeApi().postMessage(message);
  }, []);

  return { postMessage };
}
