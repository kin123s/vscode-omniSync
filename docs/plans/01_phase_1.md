# 01. Phase 1: 사이드바 UX 개선 및 안정화

> **작성일**: 2026-03-06
> **프로젝트**: vscode-omniSync

## 1. 개요

현재 Phase 1의 주요 기능(v2 REST API 호환, Webview 등)은 대부분 구현 및 병합되었으나, 1차 완성 결과물에서 도출된 UI/UX 결함과 남은 통합 단위 테스트(1.7)를 완료하여 Phase 1을 최종 마무리지어야 합니다.

## 2. 주요 목표 (액션 아이템)

### 2.1. Welcome Webview UX 픽스

1차 결과물 리뷰 중 발견된 사항들을 수정합니다.

- **프로젝트 명칭 변경**: Webview 내 표시되는 타이틀을 `Universal Agent`에서 현재 공식 프로젝트명인 `OmniSync`로 모두 변경합니다.
- **플랫폼 아이콘 클릭 활성화**: "연결할 플랫폼을 선택하세요" 하단의 플랫폼(Jira, GitHub 등) 아이콘 클릭 시 동작하지 않는 문제 수정.
  - 단순 UI 표시용으로 되어 있는 요소를 클릭 가능한 버튼/카드 형태로 전환.
  - 클릭 시 해당 플랫폼의 로그인 뷰로 연결하는 이벤트(postMessage/VS Code Webview 연동) 구현.

### 2.2. Phase 1 잔여 태스크 (통합 테스트)

- **1.7 통합 테스트**: Jira v2 REST API의 핵심 로직(이슈 조회, 코멘트 등)이 정상 작동하는지를 검증할 수 있는 단위/통합 테스트 코드 보강.

## 3. 진행 방식 (Workflow)

1. `src/welcomePanel.ts` (또는 해당하는 Webview 관련 코드) 진입하여 텍스트 및 클릭 이벤트 수정.
2. 로컬에서 VS Code Extension Development Host를 띄워 수동 검증 수행 (아이콘 클릭 및 UI 변경점 확인).
3. 테스트 코드 작성 및 실행 (`pnpm run test` 통과 확인).
4. `roadmap.md`의 진행 상태 업데이트 (해당 Task들 ✅ 완료 처리).
