/**
 * VS Code Webview API 래퍼.
 *
 * acquireVsCodeApi()는 Webview 내에서 한 번만 호출 가능하므로
 * 싱글톤으로 캐시한다.
 */

import type { WebviewApi } from '@vscode/webview-ui-toolkit';

// VS Code Webview에서 제공하는 API 타입
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// 싱글톤 캐시
let _vscodeApi: VsCodeApi | undefined;

/**
 * VS Code Webview API 인스턴스를 반환한다.
 * 개발 서버(localhost)에서는 mock을 반환하여 UI 개발이 가능하도록 한다.
 */
export function getVsCodeApi(): VsCodeApi {
  if (_vscodeApi) {
    return _vscodeApi;
  }

  // VS Code Webview 환경 감지
  if (typeof acquireVsCodeApi === 'function') {
    _vscodeApi = acquireVsCodeApi() as unknown as VsCodeApi;
  } else {
    // 개발 서버용 mock (console에 메시지 출력)
    console.warn('[OmniSync Webview] acquireVsCodeApi not available — using mock');
    _vscodeApi = {
      postMessage: (msg: unknown) => {
        console.log('[Mock postMessage]', msg);
      },
      getState: () => undefined,
      setState: (_state: unknown) => {},
    };
  }

  return _vscodeApi;
}
