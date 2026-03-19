/**
 * Orx ??Extension Host ??Webview ?묐갑??硫붿떆吏 ?꾨줈?좎퐳 ????뺤쓽.
 *
 * ?묒そ?먯꽌 import?섏뿬 ????덉쟾 硫붿떆吏 ?⑥떛??蹂댁옣?쒕떎.
 * - Extension Host: src/webviewProtocol.ts ?먯꽌 re-export
 * - Webview React:  webview-ui/src/ ?먯꽌 吏곸젒 import
 */

// ??? Extension Host ??Webview ???

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

// ??? Webview ??Extension Host ???

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
