/**
 * CSS 모듈 및 정적 자원 타입 선언.
 * Vite가 처리하는 비-TS 임포트를 TypeScript에서 인식하도록 함.
 */
declare module '*.css' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const content: string;
  export default content;
}

/**
 * VS Code Webview 환경에서 제공하는 글로벌 함수.
 * Webview 내에서 acquireVsCodeApi()를 호출하면
 * Extension Host와 통신할 수 있는 API 객체를 반환한다.
 */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
