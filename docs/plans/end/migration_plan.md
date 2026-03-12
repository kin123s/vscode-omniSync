# 마이그레이션 계획 (완료)

> **작성일**: 2026-03-05
> **상태**: ✅ 완료

기존 `jira-agent-copilot` 프로젝트에 묶여 있던 안정적인 웹뷰(Webview) 대시보드 구조 설정, 다국어 처리(i18n), 빌드 설정(pnpm, esbuild)을 새롭게 재탄생한 범용 오케스트레이터 `vscode-omniSync`로 깨끗하게 마이그레이션합니다.

## Phases

### Phase 1. 프로젝트 스캐폴딩

- [x] package.json, tsconfig, esbuild 기본 설정

### Phase 2. 소스 코드 마이그레이션

- [x] src/ 디렉토리 전체 이전

### Phase 3. i18n 설정

- [x] package.nls.json / package.nls.ko.json 마이그레이션

### Phase 4. `vscode-omniSync` 어댑터 파이프라인 합체

- [x] TrackerAdapter 인터페이스 기반 멀티 플랫폼 구조 적용
