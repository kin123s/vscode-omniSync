---
description: VSIX 빌드 및 버전 업데이트 절차
---

# 🔨 vscode-omniSync 빌드 워크플로우

## 규칙 요약

- **코드 변경이 있을 때마다** `package.json`의 PATCH 버전을 반드시 +1 올린다.
- **빌드는 항상 Docker 컨테이너**에서 수행한다. (호스트 Windows에 Node.js 설치 금지)
- 빌드 결과물: `vscode-omnisync-x.y.z.vsix`

---

## 버전 업 + 빌드 전체 절차

### 1. `package.json` 버전 PATCH +1

`package.json`의 `version` 필드에서 마지막 숫자를 1 올린다.

```json
// 예: 0.1.2 → 0.1.3
"version": "0.1.3"
```

버전 체계:

| 구분 | 규칙 |
|------|------|
| `0.0.PATCH` +1 | 버그 수정, UI 수정, 리팩토링 등 **모든 코드 변경** |
| `0.MINOR.0` +1 | 신규 기능 추가 |
| `MAJOR.0.0` | 공개 릴리스 이후 Breaking Change |

### 2. Docker로 VSIX 빌드

```bash
docker run --rm \
  -v "d:/projects/prj_jira_extension/vscode-omniSync:/workspace" \
  -w /workspace \
  node:20-alpine \
  sh -c "corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile && pnpm run package:vsix"
```

> ⚠️ `node_modules`는 Windows ↔ 컨테이너 마운트 I/O 이슈가 있으므로 컨테이너 내에서 `pnpm install`을 항상 실행한다.

### 3. 빌드 결과 확인

성공 시 아래 메시지 확인:

```
DONE  Packaged: /workspace/vscode-omnisync-x.y.z.vsix
```

### 4. VS Code에 설치 및 테스트

```
명령 팔레트 (Ctrl+Shift+P) → "VSIX에서 설치..." → vscode-omnisync-x.y.z.vsix 선택
```

또는 터미널:

```bash
code --install-extension vscode-omnisync-x.y.z.vsix
```

### 5. (선택) Git 커밋 & PR

```bash
git add package.json
git commit -m "chore: bump version to x.y.z"
# 브랜치 → PR → main 머지
```

---

## 빠른 참고

| 명령 | 설명 |
|------|------|
| `pnpm run check-types` | TypeScript 타입 검사 |
| `pnpm run lint` | ESLint 검사 |
| `pnpm run quality:fix` | ESLint 자동 수정 |
| `pnpm run package:vsix` | VSIX 패키지 생성 |
