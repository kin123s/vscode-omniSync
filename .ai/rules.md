---
description: vscode-omniSync 워크스페이스 규칙
---

# 📐 vscode-omniSync 워크스페이스 규칙

> 상위 규칙: [루트 rules.md](file:///d:/projects/prj_jira_extension/.ai/rules.md) 상속

## 1. 프로젝트 정보

| 항목 | 값 |
|------|-----|
| **역할** | 통합 에이전트 조율자 (메인 VS Code 익스텐션) |
| **상태** | ✅ Active |
| **패키지 매니저** | pnpm |

## 2. 아키텍처 및 핵심 원칙

- **Adapter Pattern**: 모든 외부 작업 트래커(Jira, GitHub 등)는 `ITrackerAdapter` 인터페이스를 통해 확장
- **Agnostic Hooking**: 작업의 과정이 아닌 '최종 결과물'(Git Diff, Test Logs) 수집에 집중
- **Webview UI**: 리포트 검토/수정을 위해 React 기반 Webview 활용, `postMessage` 통신 시 TypeScript 타입 엄격 준수

## 3. 번들러 구성

| 대상 | 번들러 | 설정 파일 |
|------|--------|-----------|
| Extension Host | **esbuild** | `esbuild.js` |
| Webview (Phase 5) | **Vite** | `vite.config.ts` |

> ⚠️ Extension Host와 Webview는 별도 번들러 — 빌드/디버그 시 혼동 주의

## 4. 개발 환경

- **Primary OS**: Windows, 실행 환경은 Docker/WSL2(Ubuntu) 컨테이너 기본
- **Drive**: `D:/projects/prj_jira_extension/vscode-omniSync` (활성 작업)
- **대용량 리소스**: `K:/` (아카이브)

## 5. 보안 및 품질

- **Zero-Trust**: 모든 API 연동 및 데이터 처리에 제로 트러스트 원칙 적용
- **Sensitive Data**: API 토큰은 `context.secrets` 암호화 저장
- **CSP**: Webview는 nonce 기반 Content Security Policy 필수
- **i18n**: `vscode-nls` 기반, `package.nls.json`/`package.nls.ko.json` 관리
- **Verification**: 배포 전 반드시 루트 `.ai/workflows/` 검증 프로세스 수행

## 6. 디렉토리 구조

```
vscode-omniSync/
├── src/
│   ├── adapters/          # 플랫폼 어댑터 (Jira, GitHub Issues 등)
│   ├── collectors/        # 결과물 수집기 (Git Diff, Test Results)
│   ├── orchestrator/      # 오케스트레이션 로직
│   ├── utils/             # 유틸리티
│   ├── webview/           # React SPA (Phase 5, Vite)
│   ├── extension.ts       # 엔트리포인트
│   └── config.ts          # 설정 관리
├── resources/             # 아이콘, SVG 에셋
├── docs/                  # 로컬 문서/리포트
├── esbuild.js             # Extension Host 번들러
├── vite.config.ts         # Webview 번들러 (Phase 5)
└── package.json
```

## 7. 특화 에이전트 연계

- 인프라, 보안, 프론트엔드 검증 시 루트 `.ai/roles/*.md` 참조
