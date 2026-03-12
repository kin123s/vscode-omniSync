import * as http from 'http';
import * as crypto from 'crypto';

/**
 * OAuth 2.0 콜백 결과
 */
export interface OAuthCallbackResult {
    code: string;
    state: string;
}

/**
 * 로컬 8765 포트에서 일회성 OAuth 콜백 HTTP 서버를 실행한다.
 *
 * - Authorization Server가 `http://localhost:8765/callback?code=xxx&state=xxx` 로 리다이렉트하면
 *   code와 state를 수신하고 즉시 서버를 종료한다.
 * - state가 일치하지 않으면 CSRF 공격으로 간주하고 에러를 반환한다.
 * - 2분(기본) 이내에 콜백이 오지 않으면 타임아웃 에러를 반환한다.
 *
 * @param expectedState CSRF 방지를 위해 openExternal 직전에 생성한 state 값
 * @param timeoutMs     콜백 대기 최대 시간(ms), 기본 120초
 */
export function waitForOAuthCallback(
    expectedState: string,
    timeoutMs = 120_000,
): Promise<OAuthCallbackResult> {
    return new Promise((resolve, reject) => {
        let settled = false;

        const settle = (fn: () => void) => {
            if (settled) { return; }
            settled = true;
            server.close();
            fn();
        };

        const server = http.createServer((req, res) => {
            try {
                const url = new URL(req.url ?? '/', `http://localhost:8765`);
                const code = url.searchParams.get('code');
                const state = url.searchParams.get('state');

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

                if (!code || state !== expectedState) {
                    res.end(buildHtml(false));
                    settle(() => reject(new Error('OAuth state 불일치 또는 code 없음')));
                    return;
                }

                res.end(buildHtml(true));
                settle(() => resolve({ code, state }));
            } catch (err) {
                res.writeHead(500);
                res.end('Internal error');
                settle(() => reject(err));
            }
        });

        // 포트 충돌 감지
        server.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                settle(() => reject(new Error('포트 8765가 이미 사용 중입니다. 다른 프로세스를 종료 후 다시 시도해 주세요.')));
            } else {
                settle(() => reject(err));
            }
        });

        server.listen(8765);

        // 타임아웃
        const timer = setTimeout(() => {
            settle(() => reject(new Error('OAuth 인증 타임아웃 (2분)')));
        }, timeoutMs);

        // 서버 종료 시 타임아웃 클리어
        server.on('close', () => clearTimeout(timer));
    });
}

/**
 * CSRF 방지용 랜덤 state 값 생성 (32 hex chars)
 */
export function generateState(): string {
    return crypto.randomBytes(16).toString('hex');
}

// ── 내부 헬퍼 ──

function buildHtml(success: boolean): string {
    const icon = success ? '✅' : '❌';
    const title = success ? '인증 완료!' : '인증 실패';
    const msg = success
        ? '이 창을 닫고 VS Code로 돌아가세요.'
        : '이 창을 닫고 VS Code에서 다시 시도해 주세요.';
    const color = success ? '#28a745' : '#dc3545';

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Jira Agent — ${title}</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
           height: 100vh; margin: 0; background: #0d1117; color: #e6edf3; }
    .card { text-align: center; padding: 40px; border-radius: 12px;
            background: #161b22; border: 1px solid #30363d; }
    h1 { font-size: 48px; margin-bottom: 8px; }
    h2 { color: ${color}; margin-bottom: 12px; }
    p { color: #8b949e; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${icon}</h1>
    <h2>${title}</h2>
    <p>${msg}</p>
  </div>
  <script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`;
}
