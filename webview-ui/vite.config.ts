import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * OmniSync Webview UI — Vite 빌드 설정
 *
 * - 빌드 출력: ../dist/webview/ (Extension Host의 dist와 같은 레벨)
 * - 단일 JS 파일로 번들링 (VS Code Webview CSP 호환)
 * - CSS도 JS에 인라인 주입
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../dist/webview'),
    emptyDirBeforeWrite: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        // 단일 번들 파일로 출력 (Webview CSP에서 다중 파일 로드 복잡도 최소화)
        entryFileNames: 'webview.js',
        chunkFileNames: 'webview-[name].js',
        assetFileNames: 'webview-[name][extname]',
      },
    },
    // CSS를 JS에 인라인 주입 → 별도 CSS 파일 불필요
    cssCodeSplit: false,
  },
  // VS Code Webview 환경에서는 base path를 상대경로로
  base: './',
});
