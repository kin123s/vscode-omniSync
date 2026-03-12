---
description: vscode-omniSync 프로젝트 컨텍스트 — 기술 스택, 진행 상태, 주요 파일 맵
---

# 🎯 vscode-omniSync 컨텍스트

## 1. 기술 스택

| 항목 | 기술 |
|------|------|
| **언어** | TypeScript (strict) |
| **프레임워크** | VS Code Extension API |
| **번들러** | esbuild (Extension), Vite (Webview) |
| **UI** | TreeView + Webview (React SPA) |
| **인증** | OAuth 2.0 + License Key |
| **i18n** | vscode-nls |

## 2. 현재 Phase 진행 상태

| Phase | 설명 | 상태 |
|-------|------|------|
| 1 | Core Extension 스캐폴딩 | ✅ 완료 |
| 2 | Jira Adapter + TreeView | ✅ 완료 |
| 3 | AI Chat Participant | ✅ 완료 |
| 4 | License Gate + OAuth | ✅ 완료 |
| 5 | **Interactive Review Webview** | 🔴 대기 (기획 완료, 구현 미착수) |

## 3. 주요 파일 맵

| 파일 | 역할 |
|------|------|
| `extension.ts` | 익스텐션 엔트리포인트, 커맨드 등록 |
| `connectionManager.ts` | Jira/GitHub 연결 관리 |
| `treeView.ts` | 사이드바 이슈 트리 렌더링 |
| `chatParticipant.ts` | AI 채팅 참여자 |
| `reporter.ts` | 인수인계서 생성 (LLM 호출) |
| `licenseManager.ts` | 라이선스 검증 게이트 |
| `oauthManager.ts` | OAuth 토큰 교환 |
| `welcomePanel.ts` | 초기 설정 Webview |
| `src/adapters/` | 플랫폼 어댑터 (ITrackerAdapter) |
| `src/collectors/` | 결과물 수집기 |

## 4. 구현 계획 참조

- 전체 아키텍처: [루트 context/architecture.md](file:///d:/projects/prj_jira_extension/.ai/context/architecture.md)
- Phase 5 구현 계획: [루트 orchestrator/02_implementation_plan.md](file:///d:/projects/prj_jira_extension/.ai/orchestrator/02_implementation_plan.md)
