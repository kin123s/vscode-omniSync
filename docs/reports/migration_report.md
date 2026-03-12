# 마이그레이션 리포트

> 대상 프로젝트: `vscode-omniSync`
> **작성일**: 2026-03-05

## 개요

`jira-agent-copilot`에서 `vscode-omniSync` (구 `universal-agent-orchestrator`)로의 핵심 기능 마이그레이션 결과를 기록합니다.

## 마이그레이션 항목

- Webview 대시보드 구조
- 다국어 처리 (i18n / vscode-nls)
- 빌드 설정 (pnpm, esbuild)
- 어댑터 파이프라인 (TrackerAdapter 인터페이스)
- OAuth 인증 흐름
- 라이선스 게이트

## 디렉토리 구조 변경

```
before (jira-agent-copilot):
  → Jira 전용 하드코딩

after (vscode-omniSync):
  → 멀티 플랫폼 어댑터 기반 아키텍처
```

## 상태

✅ 마이그레이션 완료
