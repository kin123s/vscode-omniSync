# VSIX 수동 설치 가이드

## 1. VSIX 패키징 (Docker 환경)

```bash
docker run --rm -v "D:/projects/prj_jira_extension/vscode-omniSync:/workspace" -w /workspace node:20-slim sh -c "corepack enable && pnpm run package:vsix"
```

## 2. 빌드 결과물

프로젝트 루트에 `vscode-omnisync-{version}.vsix` 생성.

## 3. 설치 방법

### 방법 A: VS Code GUI

1. VS Code 열기
2. `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. 생성된 `.vsix` 파일 선택

### 방법 B: CLI

```bash
code --install-extension "D:\projects\prj_jira_extension\vscode-omniSync\vscode-omnisync-0.1.0.vsix"
```

## 4. 의존성 재설치 (필요 시)

```bash
docker run --rm -v "D:/projects/prj_jira_extension/vscode-omniSync:/workspace" -w /workspace node:20-slim sh -c "corepack enable && pnpm install --no-frozen-lockfile"
```

## 5. 문제 해결

- `pnpm-lock.yaml`이 없거나 깨진 경우 → `--no-frozen-lockfile` 옵션으로 재설치
- `node_modules` 재구성이 필요한 경우 → 삭제 후 의존성 재설치
