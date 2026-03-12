# Universal Agent Orchestrator — 전체 로드맵

> 최종 수정: 2026-03-06

---

## 개요

VS Code 익스텐션 기반 멀티 플랫폼 프로젝트 어시스턴트.  
Jira(Cloud/Server), GitHub, Linear 등 이슈 트래커와 연동하여  
이슈 조회, AI 분석, 작업 추적, 자동 리포트를 제공한다.

---

## Phase 0: 빌드 안정화 ✅

| 항목                                            | 상태 |
| ----------------------------------------------- | ---- |
| DevContainer 기반 빌드 환경 (Node.js 20 + pnpm) | ✅   |
| TypeScript 컴파일 + esbuild 번들링              | ✅   |
| VSIX 패키징                                     | ✅   |
| `.vscodeignore` 정리                            | ✅   |

---

## Phase 1: Jira Server/DC (v2 REST API) ★★★

| MISSION | 내용                                                 | 상태 |
| ------- | ---------------------------------------------------- | ---- |
| 1.1     | v2 REST API 경로 검증 (`/rest/api/2`)                | ✅   |
| 1.2     | Wiki Markup → Plain Text 변환기                      | ✅   |
| 1.3     | 사용자 식별 분기 (v2 `name`/`key` vs v3 `accountId`) | ✅   |
| 1.4     | 코멘트 작성 v2/v3 분기                               | ✅   |
| 1.5     | SSL/인증서 처리 (self-signed cert opt-in)            | ✅   |
| 1.6     | 대시보드 v2 호환 (components, fixVersions, sprint)   | ✅   |
| 1.7     | 통합 테스트                                          | ⏳   |

### 사이드바 UX 개선 (Phase 1 부속)

| 항목                                                      | 상태 |
| --------------------------------------------------------- | ---- |
| TreeView 미인증 시에도 항상 표시                          | ✅   |
| 플랫폼 선택 카드 Webview (`welcomePanel.ts`)              | ✅   |
| 플랫폼별 로그인 폼 (Jira Server / Cloud / GitHub)         | ✅   |
| i18n 키 추가 (`tree.platform.label`, `tree.login.action`) | ✅   |

---

## Phase 2: Jira Cloud 안정화 + 고도화 ★★☆

| MISSION | 내용                                               | 상태 |
| ------- | -------------------------------------------------- | ---- |
| 2.1     | OAuth 토큰 관리 안정화 (만료/갱신/재인증)          | ⏳   |
| 2.2     | ADF 파서 고도화 (Atlassian Document Format 렌더링) | ⏳   |
| 2.3     | JQL 검색 UX 개선 (자동완성, 히스토리)              | ⏳   |
| 2.4     | 코멘트 작성 ADF 지원 (Markdown → ADF 변환)         | ⏳   |
| 2.5     | 네트워크 복원력 (재시도, 타임아웃, 오프라인 감지)  | ⏳   |
| 2.6     | 대시보드 UI 개선 (탭 구성, 코멘트 스레드 표시)     | ⏳   |

---

## Phase 3: GitHub Issues + PR ★★☆

| MISSION | 내용                                         | 상태 |
| ------- | -------------------------------------------- | ---- |
| 3.1     | `GitHubTrackerAdapter` 기본 구현             | ⏳   |
| 3.2     | GitHub API 클라이언트 (GraphQL + REST)       | ⏳   |
| 3.3     | GitHub 데이터 모델 → `TrackerIssueData` 매핑 | ⏳   |
| 3.4     | 인증 및 설정 (PAT, GitHub App)               | ⏳   |
| 3.5     | TreeView GitHub 호환 (Labels, Milestones)    | ⏳   |
| 3.6     | 대시보드 GitHub 호환                         | ⏳   |
| 3.7     | Issues ↔ PR 연결 그래프                      | ⏳   |
| 3.8     | 통합 테스트                                  | ⏳   |

---

## Phase 4: 기타 플랫폼 ★☆☆

| MISSION | 내용                                       | 상태 |
| ------- | ------------------------------------------ | ---- |
| 4.0     | 어댑터 팩토리 리팩토링 (`AdapterRegistry`) | ⏳   |
| 4.1     | Linear 지원                                | ⏳   |
| 4.2     | GitLab 지원                                | ⏳   |
| 4.3     | Azure DevOps 지원                          | ⏳   |
| 4.4     | Notion 지원 (장기)                         | ⏳   |

---

## Phase 5: Interactive Review Webview (React SPA) ★★★

> guide.md [NEW] 항목 반영. Vite 번들러 + 별도 Panel 분리 방식.

| MISSION | 내용                                                           | 상태 |
| ------- | -------------------------------------------------------------- | ---- |
| 5.1     | Vite + React Webview 스캐폴딩 (`src/webview/`, CSP 설정)       | ⏳   |
| 5.2     | `ReportReviewPanel` 클래스 (별도 Webview Panel)                | ⏳   |
| 5.3     | `postMessage` 양방향 메시지 타입 정의 (`webviewMessages.ts`)   | ⏳   |
| 5.4     | 파이프라인 변경 (3단계→5단계: 프리뷰+편집 삽입)                | ⏳   |
| 5.5     | `ExportManager` 라우팅 액션 확장 (트래커/로컬/클립보드/재작성) | ⏳   |

---

## 아키텍처 요약

```
┌─────────────────────────────────────────────┐
│  VS Code Extension (Host)                   │
│  ├── extension.ts       (진입점)            │
│  ├── treeView.ts        (사이드바)          │
│  ├── welcomePanel.ts    (플랫폼/로그인)     │
│  ├── issueDashboard.ts  (이슈 대시보드)     │
│  ├── reportReviewPanel  (리포트 리뷰) [P5]  │
│  └── chatParticipant    (@agent 채팅)       │
├─────────────────────────────────────────────┤
│  Webview (React SPA — Vite 빌드) [P5]       │
│  ├── ReportPreview      (react-markdown)    │
│  ├── ActionPanel        (라우팅 선택)       │
│  └── Editor             (인라인 편집)       │
├─────────────────────────────────────────────┤
│  Adapters                                   │
│  ├── JiraTrackerAdapter (v2/v3)             │
│  ├── GitHubTrackerAdapter (Phase 3)         │
│  └── LinearTrackerAdapter (Phase 4)         │
├─────────────────────────────────────────────┤
│  Orchestrator Pipeline                      │
│  ├── GitDiffCollector                       │
│  ├── TerminalListener                       │
│  ├── PayloadBuilder                         │
│  ├── reporter.ts → ReportReviewPanel [P5]   │
│  └── ExportManager (4개 라우팅 액션) [P5]   │
├─────────────────────────────────────────────┤
│  Types [P5]                                 │
│  └── webviewMessages.ts (양방향 메시지)     │
├─────────────────────────────────────────────┤
│  Infrastructure                             │
│  ├── connectionManager (연결 상태)          │
│  ├── oauthManager      (OAuth 2.0)          │
│  ├── licenseManager    (라이선스)            │
│  └── config.ts         (설정 관리)           │
└─────────────────────────────────────────────┘
```
