/**
 * OmniSync — Extension Host ↔ Webview 양방향 메시지 프로토콜 타입 정의.
 *
 * 양쪽에서 import하여 타입 안전 메시지 패싱을 보장한다.
 * - Extension Host: src/webviewProtocol.ts 에서 re-export
 * - Webview React:  webview-ui/src/ 에서 직접 import
 */

// ─── Extension Host → Webview ───

export interface ReportDataMessage {
  type: 'reportData';
  payload: {
    markdown: string;
    issueKey: string;
    metadata: {
      platform: string;
      generatedAt: string;
      provider?: string;
      model?: string;
    };
  };
}

export interface UpdateStatusMessage {
  type: 'updateStatus';
  payload: {
    status: 'loading' | 'ready' | 'error';
    message?: string;
  };
}

export interface PlatformInfoMessage {
  type: 'platformInfo';
  payload: {
    platform: string;
    connected: boolean;
  };
}

export type ExtToWebviewMessage =
  | ReportDataMessage
  | UpdateStatusMessage
  | PlatformInfoMessage;

// ─── Webview → Extension Host ───

export interface SendToTrackerAction {
  type: 'action:sendToTracker';
  payload: {
    issueKey: string;
    markdown: string;
  };
}

export interface SaveLocalAction {
  type: 'action:saveLocal';
  payload: {
    issueKey: string;
    markdown: string;
  };
}

export interface CopyClipboardAction {
  type: 'action:copyClipboard';
  payload: {
    markdown: string;
  };
}

export interface RegenerateAction {
  type: 'action:regenerate';
  payload: {
    issueKey: string;
    userNote?: string;
  };
}

export interface EditReportAction {
  type: 'action:editReport';
  payload: {
    markdown: string;
  };
}

export type WebviewToExtMessage =
  | SendToTrackerAction
  | SaveLocalAction
  | CopyClipboardAction
  | RegenerateAction
  | EditReportAction;
