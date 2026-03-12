# 빌드 안정화 계획

> 프로젝트: `vscode-omniSync` (VS Code Extension)
> 경로: `D:\projects\prj_jira_extension\vscode-omniSync`
> **작성일**: 2026-03-05

## 목표

빌드 파이프라인 안정화 및 CI/CD 기반 구축

## 체크리스트

- [ ] Docker 기반 빌드 환경 구축
- [ ] `pnpm tsc --noEmit` 정적 타입 체크 통과
- [ ] esbuild 번들링 → `dist/extension.js` 정상 생성
- [ ] `vsce package` → `.vsix` 정상 패키징

## 빌드 명령어

```bash
cd D:\projects\prj_jira_extension\vscode-omniSync
pnpm install
pnpm run quality
pnpm run compile
pnpm run package:vsix
```
