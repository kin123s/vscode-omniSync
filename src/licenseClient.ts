/**
 * 라이선스 서버와의 HTTP 통신을 캡슐화하는 클라이언트 모듈.
 *
 * - 외부 라이브러리 없이 Node.js 내장 fetch만 사용
 * - 10초 타임아웃 (AbortSignal.timeout)
 * - 5xx 에러 시 지수 백오프 3회 재시도 (1초, 2초, 4초)
 */

// ── 인터페이스 ──────────────────────────────────────────

export interface LicenseActivateRequest {
    email: string;
    jiraDomain: string;
    jiraAccountId: string;
    vscodeMachineId: string;
    extensionVersion: string;
}

export interface LicenseInfo {
    valid: boolean;
    key: string;
    plan: {
        name: string; // "free" | "pro" | "enterprise"
        features: Record<string, boolean>;
        limits: Record<string, number | null>;
    };
    expiresAt: string | null;
}

export interface ActivateResponse {
    token: string;
    user: { id: string; email: string };
    license: LicenseInfo;
}

export interface VerifyResponse {
    valid: boolean;
    license?: any;
    plan?: {
        name: string;
        features: Record<string, boolean>;
        limits: Record<string, number | null>;
    };
    deviceBound?: boolean;
    deviceMatch?: boolean;
    message?: string;
}

export interface UsageTrackResponse {
    tracked: boolean;
    used: number;
    limit: number | null;
    remaining: number | null;
}

// ── 에러 클래스 ─────────────────────────────────────────

export class LicenseServerError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly responseBody?: any,
    ) {
        super(message);
        this.name = 'LicenseServerError';
    }
}

// ── HTTP 클라이언트 ─────────────────────────────────────

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;

export class LicenseClient {
    private readonly serverUrl: string;

    constructor(serverUrl: string) {
        // trailing slash 제거
        this.serverUrl = serverUrl.replace(/\/$/, '');
    }

    // ── Public API ──

    /**
     * 통합 활성화 (로그인 or 자동가입 + 라이선스 검증)
     * POST /api/v1/auth/activate
     */
    async activate(req: LicenseActivateRequest): Promise<ActivateResponse> {
        return this.postJson<ActivateResponse>('/api/v1/auth/activate', req, {
            'X-Extension-Version': req.extensionVersion,
        });
    }

    /**
     * 라이선스 키 검증
     * GET /api/v1/licenses/verify?key=XXX&machineId=YYY
     */
    async verifyLicense(key: string, machineId: string): Promise<VerifyResponse> {
        const params = new URLSearchParams({ key, machineId });
        return this.getJson<VerifyResponse>(`/api/v1/licenses/verify?${params.toString()}`);
    }

    /**
     * 기능 사용량 체크 + 기록
     * POST /api/v1/usage/track
     * (JWT 토큰 필요)
     */
    async trackUsage(token: string, feature: string): Promise<UsageTrackResponse> {
        return this.postJson<UsageTrackResponse>(
            '/api/v1/usage/track',
            { feature },
            { Authorization: `Bearer ${token}` },
        );
    }

    /**
     * Heartbeat (주기적 유효성 체크)
     * POST /api/v1/licenses/heartbeat
     */
    async heartbeat(
        token: string,
        licenseKey: string,
        machineId: string,
    ): Promise<VerifyResponse> {
        return this.postJson<VerifyResponse>(
            '/api/v1/licenses/heartbeat',
            { licenseKey, machineId },
            { Authorization: `Bearer ${token}` },
        );
    }

    // ── Private Helpers ──

    private async getJson<T>(
        path: string,
        extraHeaders?: Record<string, string>,
    ): Promise<T> {
        return this.requestWithRetry<T>(async () => {
            const res = await fetch(`${this.serverUrl}${path}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...extraHeaders,
                },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            return this.handleResponse<T>(res);
        });
    }

    private async postJson<T>(
        path: string,
        body: unknown,
        extraHeaders?: Record<string, string>,
    ): Promise<T> {
        return this.requestWithRetry<T>(async () => {
            const res = await fetch(`${this.serverUrl}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...extraHeaders,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            return this.handleResponse<T>(res);
        });
    }

    /**
     * 5xx 에러 시 지수 백오프 재시도 (최대 3회)
     * 1초, 2초, 4초 간격
     */
    private async requestWithRetry<T>(
        requestFn: () => Promise<T>,
    ): Promise<T> {
        let lastError: unknown;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                return await requestFn();
            } catch (err) {
                lastError = err;

                // 5xx 에러만 재시도
                const isServerError =
                    err instanceof LicenseServerError && err.statusCode >= 500;
                if (!isServerError) {
                    throw err;
                }

                // 마지막 시도면 재시도하지 않음
                if (attempt < MAX_RETRIES - 1) {
                    const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
                    await this.sleep(delay);
                }
            }
        }

        throw lastError;
    }

    private async handleResponse<T>(res: Response): Promise<T> {
        const body = await res.json().catch(() => null);

        if (!res.ok) {
            const message =
                (body as any)?.message ??
                (body as any)?.error ??
                `HTTP ${res.status}: ${res.statusText}`;
            throw new LicenseServerError(message, res.status, body);
        }

        return body as T;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
